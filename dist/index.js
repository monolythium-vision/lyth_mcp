#!/usr/bin/env node
/**
 * lyth-mcp — Monolythium MCP server.
 *
 * The server is intentionally wallet-safe:
 * - reads live Monolythium RPC/API data;
 * - drafts and validates AI runbooks;
 * - prepares wallet approval payloads;
 * - stores local MCP wallets only as encrypted PQM-1 mnemonics;
 * - never broadcasts unless LYTH_MCP_ENABLE_SUBMIT=1 is explicitly set.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { addressbookInfo, listAddressbookContacts, removeAddressbookContact, resolveAddressbookContact, upsertAddressbookContact, } from "./addressbook.js";
import { addOutboxEntry, forgetOutboxEntry, getOutboxEntry, listOutboxEntries, outboxInfo, recordOutboxAttempt, updateOutboxStatus, } from "./outbox.js";
import { addReceipt, getReceipt, listReceipts, receiptInfo, } from "./receipts.js";
import { buildTransfer, configureLowValuePolicy, createWallet, deleteWallet, encryptionKeyFromRpc, exportMnemonic, importWallet, listWallets, unitsToDecimal, updateAgentWalletMetadata, walletStoreInfo, } from "./wallet.js";
const DEFAULT_CHAIN_ID = 69420;
const DEFAULT_NETWORK = "testnet-69420";
const DEFAULT_RPCS = [
    "http://178.105.15.216:8545",
    "http://178.104.233.182:8545",
    "http://65.108.94.1:8545",
    "http://95.216.154.155:8545",
    "http://87.99.145.48:8545",
    "http://5.223.85.76:8545",
];
const RPCS = (process.env.LYTH_RPC_URLS ?? process.env.LYTH_RPC_URL ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
const CONFIGURED_RPCS = RPCS.length > 0 ? RPCS : DEFAULT_RPCS;
const NETWORK = process.env.LYTH_NETWORK ?? DEFAULT_NETWORK;
const CHAIN_ID = Number(process.env.LYTH_CHAIN_ID ?? DEFAULT_CHAIN_ID);
const REQUEST_TIMEOUT_MS = Number(process.env.LYTH_MCP_TIMEOUT_MS ?? 10_000);
const MAX_OUTPUT = Number(process.env.LYTH_MCP_MAX_OUTPUT ?? 16_000);
const SUBMIT_ENABLED = process.env.LYTH_MCP_ENABLE_SUBMIT === "1";
const DEFAULT_LOW_VALUE_MAX = process.env.LYTH_MCP_DEFAULT_LOW_VALUE_MAX ?? "10";
const DEFAULT_LOW_VALUE_DAILY_LIMIT = process.env.LYTH_MCP_DEFAULT_LOW_VALUE_DAILY_LIMIT ?? "50";
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_VENDOR_REGISTRY_PATH = resolve(PACKAGE_ROOT, "vendors.example.json");
const VENDOR_REGISTRY_PATH = process.env.LYTH_MCP_VENDOR_REGISTRY || DEFAULT_VENDOR_REGISTRY_PATH;
function truncate(value, max = MAX_OUTPUT) {
    const text = typeof value === "string" ? value : safeStringify(value);
    return text.length > max ? `${text.slice(0, max)}\n... (truncated)` : text;
}
function safeStringify(value) {
    return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}
function text(value) {
    return { content: [{ type: "text", text: truncate(value) }] };
}
function compactWallet(wallet) {
    return {
        name: wallet.name,
        address: wallet.address,
        algorithm: wallet.algorithm,
        keyProtection: wallet.keyProtection,
        createdAt: wallet.createdAt,
        lowValue: wallet.lowValue,
        agent: wallet.agent,
    };
}
function errorText(message) {
    return { content: [{ type: "text", text: message }], isError: true };
}
function isHex(value) {
    return /^0x[0-9a-fA-F]*$/.test(value);
}
function isAddress(value) {
    return /^0x[0-9a-fA-F]{40}$/.test(value) || /^mono1[0-9a-z]+$/.test(value);
}
function isWireAddress(value) {
    return /^0x[0-9a-fA-F]{40}$/.test(value);
}
async function resolveRecipient(value) {
    const input = value.trim();
    if (isWireAddress(input)) {
        return {
            input,
            address: input,
            source: "literal",
        };
    }
    const contact = await resolveAddressbookContact(input);
    if (!contact) {
        return null;
    }
    return {
        input,
        address: contact.address,
        source: "addressbook",
        contact: {
            name: contact.name,
            note: contact.note,
            tags: contact.tags,
        },
    };
}
function toQuantity(value) {
    return `0x${value.toString(16)}`;
}
function parseQuantity(value) {
    if (typeof value !== "string") {
        throw new Error(`expected hex quantity string, got ${typeof value}`);
    }
    if (!/^0x[0-9a-fA-F]+$/.test(value)) {
        throw new Error(`invalid hex quantity: ${value}`);
    }
    return BigInt(value);
}
function parseFlexibleBigint(value) {
    const trimmed = value.trim();
    if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
        return BigInt(trimmed);
    }
    if (/^\d+$/.test(trimmed)) {
        return BigInt(trimmed);
    }
    throw new Error(`invalid integer: ${value}`);
}
function decimalToUnits(input, decimals = 18) {
    const trimmed = input.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
        throw new Error(`invalid decimal amount: ${input}`);
    }
    const [whole, frac = ""] = trimmed.split(".");
    if (frac.length > decimals) {
        throw new Error(`too many decimal places for ${decimals}-decimal asset`);
    }
    return BigInt(whole + frac.padEnd(decimals, "0"));
}
function compareDecimal(a, b, decimals = 18) {
    const aa = decimalToUnits(a, decimals);
    const bb = decimalToUnits(b, decimals);
    return aa === bb ? 0 : aa > bb ? 1 : -1;
}
function apiBaseFromRpc(endpoint) {
    const url = new URL(endpoint);
    url.pathname = "/api/v1/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
}
async function withTimeout(fn, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fn(controller.signal);
    }
    finally {
        clearTimeout(timeout);
    }
}
async function rpcCall(endpoint, method, params = []) {
    return withTimeout(async (signal) => {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "user-agent": "lyth-mcp/0.1.0",
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: Date.now(),
                method,
                params,
            }),
            signal,
        });
        const body = (await res.json());
        if (body.error) {
            throw new Error(`${method} RPC ${body.error.code}: ${body.error.message}`);
        }
        if (!("result" in body)) {
            throw new Error(`${method} returned no result; HTTP ${res.status}`);
        }
        return body.result;
    });
}
async function apiGet(endpoint, path, query = {}) {
    const url = new URL(`${apiBaseFromRpc(endpoint)}/${path.replace(/^\/+/, "")}`);
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
            url.searchParams.set(key, String(value));
        }
    }
    return withTimeout(async (signal) => {
        const res = await fetch(url, {
            headers: { "user-agent": "lyth-mcp/0.1.0" },
            signal,
        });
        const body = await res.json();
        if (!res.ok) {
            throw new Error(`API ${res.status}: ${safeStringify(body)}`);
        }
        return body;
    });
}
async function probeEndpoint(endpoint) {
    const started = Date.now();
    try {
        const chainId = parseQuantity(await rpcCall(endpoint, "eth_chainId"));
        const height = parseQuantity(await rpcCall(endpoint, "eth_blockNumber"));
        return {
            endpoint,
            ok: chainId === BigInt(CHAIN_ID),
            chainId: chainId.toString(),
            height: height.toString(),
            latencyMs: Date.now() - started,
        };
    }
    catch (err) {
        return {
            endpoint,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            latencyMs: Date.now() - started,
        };
    }
}
async function firstReachableEndpoint() {
    const probes = await Promise.all(CONFIGURED_RPCS.map(probeEndpoint));
    const selected = probes
        .filter((p) => p.ok === true)
        .sort((a, b) => Number(BigInt(b.height) - BigInt(a.height)) || a.latencyMs - b.latencyMs)[0];
    if (!selected) {
        throw new Error(`no reachable Monolythium RPC for chain ${CHAIN_ID}: ${safeStringify(probes)}`);
    }
    return selected.endpoint;
}
function runbookCatalogue() {
    return [
        {
            name: "request_funds",
            status: "draft_only",
            purpose: "Ask the principal to fund an agent wallet for a bounded task.",
            requiredFields: ["agentAddress", "amount", "asset", "purpose"],
        },
        {
            name: "pay_vendor",
            status: "live_preparable",
            purpose: "Prepare a wallet-approved native LYTH payment to a vendor or service.",
            requiredFields: ["recipient", "amount", "asset"],
            liveLimit: "Native LYTH transfers can be prepared today. Token payments need MRC/bridge support once live.",
        },
        {
            name: "book_service",
            status: "draft_only",
            purpose: "Express an agent workflow for booking an external service under a spending policy.",
            requiredFields: ["vendorId", "service", "amount", "asset"],
        },
        {
            name: "open_escrow",
            status: "draft_only",
            purpose: "Draft an escrow workflow. Broadcast support waits for the escrow module/contract surface.",
            requiredFields: ["counterparty", "amount", "asset", "deliverable"],
        },
        {
            name: "place_trade",
            status: "draft_only",
            purpose: "Draft a spot-market order intent for wallet or trading-interface approval.",
            requiredFields: ["marketId", "side", "amount", "limitPrice"],
        },
        {
            name: "set_spending_policy",
            status: "draft_only",
            purpose: "Draft an agent spending policy update for wallet approval.",
            requiredFields: ["agentAddress", "policy"],
        },
        {
            name: "revoke_agent_permission",
            status: "draft_only",
            purpose: "Draft revocation of an agent permission or spending policy.",
            requiredFields: ["agentAddress", "permissionId"],
        },
        {
            name: "verify_receipt",
            status: "live_read",
            purpose: "Read and verify a transaction receipt on the live chain.",
            requiredFields: ["txHash"],
        },
        {
            name: "rate_vendor",
            status: "draft_only",
            purpose: "Draft a vendor reputation update after completion.",
            requiredFields: ["vendorId", "rating", "receipt"],
        },
    ];
}
function buildRunbookDraft(args) {
    const fields = args.fields ?? {};
    const policy = args.policy ?? {};
    const amount = String(fields.amount ?? "");
    const asset = String(fields.asset ?? "LYTH").toUpperCase();
    const vendor = String(fields.vendorId ?? fields.vendor ?? fields.recipient ?? "");
    const category = String(fields.category ?? fields.serviceCategory ?? "");
    const approvalPrompt = approvalPromptFor(args.runbook, fields);
    const id = `rb_${args.runbook}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const walletRequests = [];
    const risks = [
        "The MCP server does not hold keys and cannot approve spending by itself.",
        "The user must inspect the wallet approval before signing.",
    ];
    const notes = [
        "This runbook is a typed intent. It is not a signed transaction.",
        "Use prepare_wallet_request for wallet-compatible approval payloads where supported.",
    ];
    let title = args.runbook;
    let status = "draft_only";
    let liveExecution = {
        supported: false,
        mode: "not_live",
        reason: "This runbook needs a future module, external service connector, or wallet integration.",
    };
    let steps = [
        { id: "check_policy", title: "Check spending policy", detail: "Validate asset, amount, vendor, category, expiry, and approval requirement." },
        { id: "request_approval", title: "Request approval", detail: "Show the user the exact action before execution." },
    ];
    if (args.runbook === "request_funds") {
        title = "Request agent wallet funding";
        steps = [
            ...steps,
            { id: "show_address", title: "Show agent wallet address", detail: "Ask the principal to fund the agent wallet or set a bounded allowance." },
            { id: "verify_funds", title: "Verify funds", detail: "Check the live chain for the incoming payment before work starts." },
        ];
    }
    if (args.runbook === "pay_vendor") {
        title = "Pay vendor";
        status = asset === "LYTH" ? "live_preparable" : "draft_only";
        liveExecution = asset === "LYTH"
            ? {
                supported: true,
                mode: "wallet_approval",
                reason: "Native LYTH transfer can be prepared as an eth_sendTransaction wallet request.",
            }
            : {
                supported: false,
                mode: "not_live",
                reason: `${asset} token payment needs token/MRC/bridge module support before this MCP can prepare a live payload.`,
            };
        steps = [
            ...steps,
            { id: "resolve_vendor", title: "Resolve vendor", detail: "Confirm the vendor address, display name, and route risk." },
            { id: "submit_payment", title: "Submit payment", detail: "Send the approved payment through the user's wallet." },
            { id: "record_receipt", title: "Record receipt", detail: "Track the resulting transaction hash and receipt." },
        ];
        if (asset !== "LYTH") {
            risks.push("Non-native assets require token-route metadata and are not live-preparable in this MVP.");
        }
        if (typeof fields.recipient === "string" && !isWireAddress(fields.recipient)) {
            notes.push("Wallet payload preparation needs a 0x wire address. mono1 display addresses should be resolved by the wallet or SDK first.");
        }
    }
    if (args.runbook === "book_service") {
        title = "Book service";
        steps = [
            ...steps,
            { id: "discover_vendor", title: "Discover vendor", detail: "Find a vendor through the local registry or an external connector." },
            { id: "confirm_terms", title: "Confirm terms", detail: "Confirm service, price, delivery window, refund path, and tip policy." },
            { id: "pay_or_escrow", title: "Pay or escrow", detail: "Use pay_vendor for simple payment or open_escrow for deliverable-based work." },
        ];
    }
    if (args.runbook === "open_escrow") {
        title = "Open escrow";
        risks.push("Escrow broadcast support waits for the escrow module or deployed contract surface.");
        steps = [
            ...steps,
            { id: "define_deliverable", title: "Define deliverable", detail: "Record deliverable, acceptance criteria, deadline, and arbiter." },
            { id: "lock_funds", title: "Lock funds", detail: "Lock funds after wallet approval once the live escrow surface is available." },
        ];
    }
    if (args.runbook === "place_trade") {
        title = "Place spot-market order";
        risks.push("Market orders can move price. Always show market, side, limit price, slippage, and max spend.");
        steps = [
            ...steps,
            { id: "load_market", title: "Load market", detail: "Read the live order book/trades for the selected market." },
            { id: "check_slippage", title: "Check slippage", detail: "Confirm limit price, max spend, and cancellation policy." },
            { id: "submit_order", title: "Submit order", detail: "Submit through a wallet or trading interface once live order payload support is wired." },
        ];
    }
    if (args.runbook === "set_spending_policy") {
        title = "Set spending policy";
        steps = [
            ...steps,
            { id: "render_policy", title: "Render policy", detail: "Show the budget, allowed assets, vendors, categories, expiry, and revocation path." },
            { id: "apply_policy", title: "Apply policy", detail: "Submit the policy update through the wallet when the policy transaction builder is wired." },
        ];
    }
    if (args.runbook === "revoke_agent_permission") {
        title = "Revoke agent permission";
        risks.push("Revocation should be prioritized when a key, device, vendor, or agent is suspected compromised.");
        steps = [
            ...steps,
            { id: "select_permission", title: "Select permission", detail: "Identify the agent permission, allowance, or session to revoke." },
            { id: "submit_revoke", title: "Submit revocation", detail: "Submit revocation through the wallet and verify receipt." },
        ];
    }
    if (args.runbook === "verify_receipt") {
        title = "Verify receipt";
        status = "live_preparable";
        liveExecution = {
            supported: true,
            mode: "wallet_approval",
            reason: "Receipt verification is read-only and can run against the live chain.",
        };
        steps = [
            { id: "fetch_receipt", title: "Fetch receipt", detail: "Read transaction status and receipt from the live chain." },
            { id: "match_expectation", title: "Match expectation", detail: "Compare sender, recipient, amount, status, and block height against the runbook." },
        ];
    }
    if (args.runbook === "rate_vendor") {
        title = "Rate vendor";
        steps = [
            ...steps,
            { id: "verify_receipt", title: "Verify receipt", detail: "Confirm the referenced payment or escrow release happened." },
            { id: "submit_rating", title: "Submit rating", detail: "Record rating through the vendor registry once the live reputation surface is available." },
        ];
    }
    if (amount && policy.maxAmount && compareDecimal(amount, policy.maxAmount) > 0) {
        risks.push(`Requested amount ${amount} exceeds policy maxAmount ${policy.maxAmount}.`);
    }
    if (policy.assetAllowlist && !policy.assetAllowlist.map((a) => a.toUpperCase()).includes(asset)) {
        risks.push(`Asset ${asset} is not in the policy asset allowlist.`);
    }
    if (policy.vendorAllowlist && vendor && !policy.vendorAllowlist.includes(vendor)) {
        risks.push(`Vendor/counterparty ${vendor} is not in the policy vendor allowlist.`);
    }
    if (policy.categoryAllowlist && category && !policy.categoryAllowlist.includes(category)) {
        risks.push(`Category ${category} is not in the policy category allowlist.`);
    }
    if (policy.expiresAt && Date.parse(policy.expiresAt) < Date.now()) {
        risks.push(`Policy expired at ${policy.expiresAt}.`);
    }
    return {
        schemaVersion: 1,
        id,
        network: NETWORK,
        chainId: CHAIN_ID,
        runbook: args.runbook,
        title,
        status,
        createdAt: new Date().toISOString(),
        agent: args.agent ?? {},
        principal: args.principal ?? {},
        fields,
        policy,
        approval: {
            required: true,
            reason: "Agent economic actions require explicit user approval before signing or broadcasting.",
            prompt: approvalPrompt,
        },
        liveExecution,
        steps,
        walletRequests,
        risks,
        notes,
    };
}
function approvalPromptFor(runbook, fields) {
    const amount = fields.amount ? `${fields.amount} ${String(fields.asset ?? "LYTH").toUpperCase()}` : "the requested amount";
    switch (runbook) {
        case "pay_vendor":
            return `Approve payment of ${amount} to ${String(fields.recipient ?? fields.vendorId ?? "the vendor")}?`;
        case "request_funds":
            return `Fund agent wallet ${String(fields.agentAddress ?? "(missing address)")} with ${amount}?`;
        case "book_service":
            return `Approve booking ${String(fields.service ?? "the service")} for up to ${amount}?`;
        case "open_escrow":
            return `Approve escrow of ${amount} for ${String(fields.deliverable ?? "the deliverable")}?`;
        case "place_trade":
            return `Approve ${String(fields.side ?? "order")} on ${String(fields.marketId ?? "the market")} with max amount ${amount}?`;
        case "set_spending_policy":
            return `Approve new spending policy for ${String(fields.agentAddress ?? "the agent")}?`;
        case "revoke_agent_permission":
            return `Revoke permission ${String(fields.permissionId ?? "")} for ${String(fields.agentAddress ?? "the agent")}?`;
        case "verify_receipt":
            return `Verify receipt ${String(fields.txHash ?? "")}?`;
        case "rate_vendor":
            return `Record vendor rating for ${String(fields.vendorId ?? "the vendor")}?`;
    }
}
function validateRunbook(draft) {
    const violations = [];
    const warnings = [];
    const fields = draft.fields ?? {};
    const policy = draft.policy ?? {};
    const amount = typeof fields.amount === "string" ? fields.amount : undefined;
    const asset = String(fields.asset ?? "LYTH").toUpperCase();
    const recipient = typeof fields.recipient === "string" ? fields.recipient : undefined;
    const vendor = String(fields.vendorId ?? fields.vendor ?? fields.recipient ?? "");
    const category = String(fields.category ?? fields.serviceCategory ?? "");
    if (!draft.approval?.required) {
        violations.push("approval.required must be true for economic runbooks.");
    }
    if (amount) {
        try {
            decimalToUnits(amount);
        }
        catch (err) {
            violations.push(err instanceof Error ? err.message : String(err));
        }
    }
    if (amount && policy.maxAmount) {
        try {
            if (compareDecimal(amount, policy.maxAmount) > 0) {
                violations.push(`amount ${amount} exceeds maxAmount ${policy.maxAmount}`);
            }
        }
        catch (err) {
            violations.push(err instanceof Error ? err.message : String(err));
        }
    }
    if (policy.assetAllowlist && !policy.assetAllowlist.map((a) => a.toUpperCase()).includes(asset)) {
        violations.push(`asset ${asset} is not allow-listed`);
    }
    if (policy.vendorAllowlist && vendor && !policy.vendorAllowlist.includes(vendor)) {
        violations.push(`vendor/counterparty ${vendor} is not allow-listed`);
    }
    if (policy.categoryAllowlist && category && !policy.categoryAllowlist.includes(category)) {
        violations.push(`category ${category} is not allow-listed`);
    }
    if (policy.expiresAt && Date.parse(policy.expiresAt) < Date.now()) {
        violations.push(`policy expired at ${policy.expiresAt}`);
    }
    if (recipient && !isAddress(recipient)) {
        violations.push(`recipient is not a recognized Mono address: ${recipient}`);
    }
    if (draft.runbook === "pay_vendor" && asset !== "LYTH") {
        warnings.push("MVP can only prepare native LYTH transfer payloads; token payments remain draft-only.");
    }
    if (draft.runbook === "pay_vendor" && recipient && !isWireAddress(recipient)) {
        warnings.push("prepare_wallet_request needs a 0x wire address; resolve mono1 before wallet approval.");
    }
    if (policy.requireHumanApproval === false) {
        violations.push("requireHumanApproval=false is not allowed for MCP economic actions.");
    }
    return {
        ok: violations.length === 0,
        violations,
        warnings,
        checkedAt: new Date().toISOString(),
    };
}
function prepareWalletRequest(draft, from) {
    const validation = validateRunbook(draft);
    if (!validation.ok) {
        return { prepared: false, validation };
    }
    if (draft.runbook !== "pay_vendor") {
        return {
            prepared: false,
            validation,
            reason: `${draft.runbook} does not have a live wallet payload builder in this MVP.`,
        };
    }
    const recipient = String(draft.fields.recipient ?? "");
    const amount = String(draft.fields.amount ?? "");
    const asset = String(draft.fields.asset ?? "LYTH").toUpperCase();
    if (asset !== "LYTH") {
        return {
            prepared: false,
            validation,
            reason: "Only native LYTH transfer payloads are live-preparable in this MVP.",
        };
    }
    if (!from || !isWireAddress(from)) {
        return {
            prepared: false,
            validation,
            reason: "A 0x sender address is required to prepare eth_sendTransaction.",
        };
    }
    if (!isWireAddress(recipient)) {
        return {
            prepared: false,
            validation,
            reason: "A 0x recipient address is required. Resolve mono1 display addresses in the wallet/SDK first.",
        };
    }
    const value = toQuantity(decimalToUnits(amount));
    const request = {
        method: "eth_sendTransaction",
        params: [
            {
                from,
                to: recipient,
                value,
                data: "0x",
                chainId: toQuantity(BigInt(CHAIN_ID)),
            },
        ],
    };
    return {
        prepared: true,
        validation,
        approvalRequired: true,
        walletRequest: request,
        deeplink: `monolythium://send?to=${encodeURIComponent(recipient)}&amount=${encodeURIComponent(amount)}&asset=LYTH&chainId=${CHAIN_ID}`,
        reminder: "The wallet must render and approve this request. prepare_wallet_request only drafts; it does not sign.",
    };
}
async function loadVendors() {
    const raw = await readFile(VENDOR_REGISTRY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const vendors = Array.isArray(parsed) ? parsed : parsed.vendors;
    if (!Array.isArray(vendors)) {
        throw new Error("vendor registry must be an array or an object with a vendors array");
    }
    const metadata = Array.isArray(parsed)
        ? {}
        : Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "vendors"));
    return { source: VENDOR_REGISTRY_PATH, ...metadata, vendors };
}
function outboxMethod(kind) {
    return kind === "eth_raw" ? "eth_sendRawTransaction" : "lyth_submitEncrypted";
}
async function submitPayload(endpoint, kind, payloadHex) {
    return rpcCall(endpoint, outboxMethod(kind), [payloadHex]);
}
function mdTable(headers, rows) {
    const escape = (value) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");
    return [
        `| ${headers.map(escape).join(" | ")} |`,
        `| ${headers.map(() => "---").join(" | ")} |`,
        ...rows.map((row) => `| ${row.map((value) => escape(value)).join(" | ")} |`),
    ].join("\n");
}
function short(value, left = 6, right = 4) {
    if (!value) {
        return "";
    }
    return value.length <= left + right + 3 ? value : `${value.slice(0, left)}...${value.slice(-right)}`;
}
async function txStatusSummary(args) {
    const outbox = args.outboxId ? await getOutboxEntry(args.outboxId) : null;
    const txHash = args.txHash ?? outbox?.txHash;
    if (!txHash) {
        return {
            outbox,
            status: outbox?.status ?? "not_found",
            reason: "No tx hash is available yet. The payload may be signed but not submitted.",
        };
    }
    const endpoint = await firstReachableEndpoint();
    const [status, receipt, tx] = await Promise.allSettled([
        rpcCall(endpoint, "lyth_txStatus", [txHash]),
        rpcCall(endpoint, "eth_getTransactionReceipt", [txHash]),
        rpcCall(endpoint, "eth_getTransactionByHash", [txHash]),
    ]);
    let derived = "submitted";
    if (receipt.status === "fulfilled" && receipt.value) {
        const receiptObject = receipt.value;
        derived = receiptObject?.status === "0x0" ? "failed" : "confirmed";
        if (outbox) {
            await updateOutboxStatus(outbox.id, derived, txHash);
        }
    }
    else if (tx.status === "fulfilled" && tx.value === null) {
        derived = "not_found";
    }
    return {
        endpoint,
        txHash,
        outbox,
        derived,
        status: status.status === "fulfilled" ? status.value : { error: status.reason?.message ?? String(status.reason) },
        receipt: receipt.status === "fulfilled" ? receipt.value : { error: receipt.reason?.message ?? String(receipt.reason) },
        transaction: tx.status === "fulfilled" ? tx.value : { error: tx.reason?.message ?? String(tx.reason) },
    };
}
const runbookEnum = z.enum([
    "request_funds",
    "pay_vendor",
    "book_service",
    "open_escrow",
    "place_trade",
    "set_spending_policy",
    "revoke_agent_permission",
    "verify_receipt",
    "rate_vendor",
]);
const outboxStatusEnum = z.enum(["signed", "submitted", "confirmed", "failed", "expired"]);
const receiptStatusEnum = z.enum(["drafted", "signed", "submitted", "confirmed", "failed"]);
const recordSchema = z.record(z.unknown()).optional();
const policySchema = z.object({
    maxAmount: z.string().optional(),
    assetAllowlist: z.array(z.string()).optional(),
    vendorAllowlist: z.array(z.string()).optional(),
    categoryAllowlist: z.array(z.string()).optional(),
    expiresAt: z.string().optional(),
    requireHumanApproval: z.boolean().optional(),
}).optional();
const server = new McpServer({
    name: "lyth-mcp",
    version: "0.1.0",
});
server.tool("chain_status", "Probe Monolythium live RPC endpoints and return chain/indexer/mempool status.", {}, async () => {
    const probes = await Promise.all(CONFIGURED_RPCS.map(probeEndpoint));
    const endpoint = await firstReachableEndpoint();
    const [stats, round, mempool, indexer, sync] = await Promise.allSettled([
        rpcCall(endpoint, "lyth_chainStats"),
        rpcCall(endpoint, "lyth_currentRound"),
        rpcCall(endpoint, "lyth_mempoolStatus"),
        rpcCall(endpoint, "lyth_indexerStatus"),
        rpcCall(endpoint, "lyth_syncStatus"),
    ]);
    return text({
        network: NETWORK,
        chainId: CHAIN_ID,
        selectedEndpoint: endpoint,
        apiBase: apiBaseFromRpc(endpoint),
        submitEnabled: SUBMIT_ENABLED,
        probes,
        stats: stats.status === "fulfilled" ? stats.value : { error: stats.reason?.message ?? String(stats.reason) },
        round: round.status === "fulfilled" ? round.value : { error: round.reason?.message ?? String(round.reason) },
        mempool: mempool.status === "fulfilled" ? mempool.value : { error: mempool.reason?.message ?? String(mempool.reason) },
        indexer: indexer.status === "fulfilled" ? indexer.value : { error: indexer.reason?.message ?? String(indexer.reason) },
        sync: sync.status === "fulfilled" ? sync.value : { error: sync.reason?.message ?? String(sync.reason) },
    });
});
server.tool("mcp_self_check", "Check MCP install, config, stores, and RPC reachability.", {}, async () => {
    const probes = await Promise.all(CONFIGURED_RPCS.map(probeEndpoint));
    const selected = probes
        .filter((probe) => probe.ok)
        .sort((a, b) => Number(BigInt(b.height ?? "0") - BigInt(a.height ?? "0")) || a.latencyMs - b.latencyMs)[0];
    return text({
        ok: Boolean(selected),
        checkedAt: new Date().toISOString(),
        package: {
            name: "lyth-mcp",
            version: "0.1.0",
            root: PACKAGE_ROOT,
        },
        network: NETWORK,
        chainId: CHAIN_ID,
        submitEnabled: SUBMIT_ENABLED,
        rpc: {
            configured: CONFIGURED_RPCS,
            selected: selected?.endpoint ?? null,
            probes,
        },
        stores: {
            wallet: await walletStoreInfo(),
            addressbook: await addressbookInfo(),
            outbox: await outboxInfo(),
            receipts: await receiptInfo(),
            vendorRegistry: VENDOR_REGISTRY_PATH,
        },
        guidance: [
            SUBMIT_ENABLED
                ? "Broadcasting is enabled; signed payloads can be submitted."
                : "Broadcasting is disabled; signed payloads are stored in the outbox and can be retried after LYTH_MCP_ENABLE_SUBMIT=1.",
            "Use explicit agent wallets only for capped operating budgets.",
            "Use wallet handoff/passphrase approval for high-value funds.",
        ],
    });
});
server.tool("wallet_funding_address", "Create or return a local testnet agent wallet address for funding. If missing, creates a local-machine encrypted wallet with capped low-value signing.", {
    name: z.string().min(1).optional().describe("Local wallet name. Default agent-main."),
    createIfMissing: z.boolean().optional().describe("Create the wallet if it does not exist. Default true."),
    lowValueMaxAmount: z.string().optional().describe(`Max LYTH per no-passphrase transaction. Default ${DEFAULT_LOW_VALUE_MAX}.`),
    lowValueDailyLimit: z.string().optional().describe(`Daily LYTH cap for no-passphrase signing. Default ${DEFAULT_LOW_VALUE_DAILY_LIMIT}.`),
}, async ({ name, createIfMissing, lowValueMaxAmount, lowValueDailyLimit }) => {
    const walletName = name ?? "agent-main";
    const existing = (await listWallets()).find((wallet) => wallet.name === walletName);
    if (existing) {
        return text({
            created: false,
            wallet: compactWallet(existing),
            fundingAddress: existing.address,
            network: NETWORK,
            chainId: CHAIN_ID,
            warning: "This is a local MCP wallet address. Fund it only with testnet or capped agent funds.",
        });
    }
    if (createIfMissing === false) {
        return errorText(`wallet '${walletName}' not found`);
    }
    const wallet = await createWallet({
        name: walletName,
        allowLocalKey: true,
        lowValue: {
            enabled: true,
            maxAmount: lowValueMaxAmount ?? DEFAULT_LOW_VALUE_MAX,
            dailyLimit: lowValueDailyLimit ?? DEFAULT_LOW_VALUE_DAILY_LIMIT,
        },
    });
    return text({
        created: true,
        wallet: compactWallet(wallet),
        fundingAddress: wallet.address,
        network: NETWORK,
        chainId: CHAIN_ID,
        warning: "Created a local-machine encrypted agent wallet. It can sign only within the configured low-value cap without a passphrase.",
    });
});
server.tool("wallet_setup", "Create and store a local encrypted agent wallet. With no passphrase, creates a local-machine protected low-value wallet for testnet agent funding.", {
    name: z.string().min(1).describe("Local wallet name, e.g. agent-main."),
    passphrase: z.string().min(12).optional().describe("Encryption passphrase. If omitted, a local machine key is used and low-value mode defaults on."),
    revealMnemonic: z.boolean().optional().describe("Return the generated 24-word PQM-1 mnemonic once. Default false."),
    overwrite: z.boolean().optional().describe("Replace an existing wallet with the same name."),
    lowValueNoPassphrase: z.boolean().optional().describe("Enable local hot mode for capped low-value spends. Defaults true when passphrase is omitted."),
    lowValueMaxAmount: z.string().optional().describe(`Max LYTH per transaction for no-passphrase signing. Default ${DEFAULT_LOW_VALUE_MAX} in local-key mode.`),
    lowValueDailyLimit: z.string().optional().describe(`Optional daily LYTH cap for no-passphrase signing. Default ${DEFAULT_LOW_VALUE_DAILY_LIMIT} in local-key mode.`),
}, async ({ name, passphrase, revealMnemonic, overwrite, lowValueNoPassphrase, lowValueMaxAmount, lowValueDailyLimit }) => {
    const hasPassphrase = Boolean(passphrase ?? process.env.LYTH_MCP_WALLET_PASSPHRASE);
    const useLocalKey = !hasPassphrase && lowValueNoPassphrase !== false;
    const enableLowValue = lowValueNoPassphrase ?? useLocalKey;
    const wallet = await createWallet({
        name,
        passphrase,
        revealMnemonic,
        overwrite,
        allowLocalKey: useLocalKey,
        lowValue: enableLowValue
            ? {
                enabled: true,
                maxAmount: lowValueMaxAmount ?? DEFAULT_LOW_VALUE_MAX,
                dailyLimit: lowValueDailyLimit ?? (useLocalKey ? DEFAULT_LOW_VALUE_DAILY_LIMIT : undefined),
            }
            : undefined,
    });
    return text({
        wallet: compactWallet(wallet),
        fundingAddress: wallet.address,
        warning: enableLowValue
            ? "Low-value mode is a local hot-wallet mode. Keep only capped funds in this agent wallet."
            : "Wallet is encrypted. Signing requires passphrase or later low-value setup.",
    });
});
server.tool("wallet_import", "Import an existing PQM-1 mnemonic into the local encrypted wallet store.", {
    name: z.string().min(1),
    mnemonic: z.string().describe("24-word PQM-1 mnemonic."),
    passphrase: z.string().min(12).optional(),
    overwrite: z.boolean().optional(),
    lowValueNoPassphrase: z.boolean().optional(),
    lowValueMaxAmount: z.string().optional(),
    lowValueDailyLimit: z.string().optional(),
}, async ({ name, mnemonic, passphrase, overwrite, lowValueNoPassphrase, lowValueMaxAmount, lowValueDailyLimit }) => {
    const hasPassphrase = Boolean(passphrase ?? process.env.LYTH_MCP_WALLET_PASSPHRASE);
    const useLocalKey = !hasPassphrase && lowValueNoPassphrase === true;
    return text(await importWallet({
        name,
        mnemonic,
        passphrase,
        overwrite,
        allowLocalKey: useLocalKey,
        lowValue: lowValueNoPassphrase
            ? {
                enabled: true,
                maxAmount: lowValueMaxAmount ?? DEFAULT_LOW_VALUE_MAX,
                dailyLimit: lowValueDailyLimit,
            }
            : undefined,
    }));
});
server.tool("wallet_list", "List local MCP wallets and low-value signing policy status.", {}, async () => {
    return text({
        store: await walletStoreInfo(),
        wallets: await listWallets(),
    });
});
server.tool("agent_wallet_create", "Create an explicit low-value agent operating wallet with user-approved purpose and caps.", {
    name: z.string().min(1).describe("Local agent wallet name, e.g. pizza-agent."),
    purpose: z.string().min(1).describe("What the agent wallet is allowed to be used for."),
    confirm: z.literal("CREATE_AGENT_WALLET").describe("Required explicit confirmation."),
    maxBalance: z.string().optional().describe("Recommended max balance to keep in the wallet."),
    lowValueMaxAmount: z.string().optional().describe(`Max LYTH per local no-passphrase transaction. Default ${DEFAULT_LOW_VALUE_MAX}.`),
    lowValueDailyLimit: z.string().optional().describe(`Daily LYTH cap. Default ${DEFAULT_LOW_VALUE_DAILY_LIMIT}.`),
    allowedCounterparties: z.array(z.string()).optional().describe("Optional contact names or 0x addresses this wallet should prefer."),
    allowedCategories: z.array(z.string()).optional().describe("Optional categories such as food, travel, legal."),
    expiresAt: z.string().optional().describe("Optional ISO expiry for this operating wallet."),
    fallbackApproval: z.enum(["passphrase", "wallet_handoff", "deny"]).optional().describe("What to do when a request exceeds limits."),
    revealMnemonic: z.boolean().optional().describe("Return the generated mnemonic once. Default false."),
    overwrite: z.boolean().optional(),
}, async ({ name, purpose, maxBalance, lowValueMaxAmount, lowValueDailyLimit, allowedCounterparties, allowedCategories, expiresAt, fallbackApproval, revealMnemonic, overwrite }) => {
    const wallet = await createWallet({
        name,
        revealMnemonic,
        overwrite,
        allowLocalKey: true,
        lowValue: {
            enabled: true,
            maxAmount: lowValueMaxAmount ?? DEFAULT_LOW_VALUE_MAX,
            dailyLimit: lowValueDailyLimit ?? DEFAULT_LOW_VALUE_DAILY_LIMIT,
        },
        agent: {
            purpose,
            network: NETWORK,
            maxBalance,
            allowedCounterparties,
            allowedCategories,
            expiresAt,
            fallbackApproval: fallbackApproval ?? "wallet_handoff",
            paused: false,
        },
    });
    const receipt = await addReceipt({
        kind: "agent_wallet_create",
        status: "confirmed",
        network: NETWORK,
        chainId: CHAIN_ID,
        title: `Created agent wallet ${name}`,
        summary: `${name} (${wallet.address}) for ${purpose}`,
        walletName: name,
        from: wallet.address,
        result: compactWallet(wallet),
    });
    return text({
        wallet: compactWallet(wallet),
        fundingAddress: wallet.address,
        receipt,
        warning: "This is an explicitly authorized low-value agent hot wallet. Fund it only with the operating budget approved for this purpose.",
    });
});
server.tool("agent_wallet_fund_request", "Draft a human-readable request to fund an agent wallet for a bounded task.", {
    name: z.string().min(1),
    amount: z.string().describe("Requested amount."),
    asset: z.string().optional().describe("Asset symbol. Default LYTH."),
    purpose: z.string().min(1),
    expiresAt: z.string().optional(),
}, async ({ name, amount, asset, purpose, expiresAt }) => {
    const wallet = (await listWallets()).find((item) => item.name === name);
    if (!wallet) {
        return errorText(`wallet '${name}' not found`);
    }
    const draft = buildRunbookDraft({
        runbook: "request_funds",
        fields: {
            agentAddress: wallet.address,
            amount,
            asset: asset ?? "LYTH",
            purpose,
            expiresAt,
        },
        policy: {
            maxAmount: amount,
            assetAllowlist: [asset ?? "LYTH"],
            expiresAt,
            requireHumanApproval: true,
        },
        agent: {
            name,
            address: wallet.address,
            purpose: wallet.agent && typeof wallet.agent === "object" ? wallet.agent.purpose : undefined,
        },
    });
    const receipt = await addReceipt({
        kind: "agent_wallet_fund_request",
        status: "drafted",
        network: NETWORK,
        chainId: CHAIN_ID,
        title: `Funding request for ${name}`,
        summary: `Request ${amount} ${asset ?? "LYTH"} for ${purpose}`,
        walletName: name,
        to: wallet.address,
        amount,
        asset: asset ?? "LYTH",
        result: draft,
    });
    return text({
        wallet: compactWallet(wallet),
        fundingAddress: wallet.address,
        draft,
        receipt,
        message: `Send up to ${amount} ${asset ?? "LYTH"} to ${wallet.address} for: ${purpose}`,
    });
});
server.tool("agent_wallet_limits", "Update explicit limits and metadata for an agent operating wallet.", {
    name: z.string().min(1),
    confirm: z.literal("UPDATE_AGENT_WALLET_LIMITS"),
    lowValueMaxAmount: z.string().optional(),
    lowValueDailyLimit: z.string().optional(),
    maxBalance: z.string().optional(),
    allowedCounterparties: z.array(z.string()).optional(),
    allowedCategories: z.array(z.string()).optional(),
    expiresAt: z.string().optional(),
    fallbackApproval: z.enum(["passphrase", "wallet_handoff", "deny"]).optional(),
}, async ({ name, lowValueMaxAmount, lowValueDailyLimit, maxBalance, allowedCounterparties, allowedCategories, expiresAt, fallbackApproval }) => {
    let wallet = (await listWallets()).find((item) => item.name === name);
    if (!wallet) {
        return errorText(`wallet '${name}' not found`);
    }
    if (lowValueMaxAmount || lowValueDailyLimit) {
        wallet = await configureLowValuePolicy({
            name,
            enabled: true,
            maxAmount: lowValueMaxAmount ?? String(wallet.lowValue && typeof wallet.lowValue === "object" ? wallet.lowValue.maxAmount ?? DEFAULT_LOW_VALUE_MAX : DEFAULT_LOW_VALUE_MAX),
            dailyLimit: lowValueDailyLimit ?? (wallet.lowValue && typeof wallet.lowValue === "object" ? wallet.lowValue.dailyLimit : undefined),
        });
    }
    wallet = await updateAgentWalletMetadata({
        name,
        patch: {
            maxBalance,
            allowedCounterparties,
            allowedCategories,
            expiresAt,
            fallbackApproval,
            paused: false,
        },
    });
    const receipt = await addReceipt({
        kind: "agent_wallet_limits",
        status: "confirmed",
        network: NETWORK,
        chainId: CHAIN_ID,
        title: `Updated agent wallet limits for ${name}`,
        summary: `${name} limits updated`,
        walletName: name,
        result: compactWallet(wallet),
    });
    return text({ wallet: compactWallet(wallet), receipt });
});
server.tool("agent_wallet_pause", "Pause an agent wallet by disabling low-value local signing and marking the wallet paused.", {
    name: z.string().min(1),
    confirm: z.literal("PAUSE_AGENT_WALLET"),
}, async ({ name }) => {
    await configureLowValuePolicy({ name, enabled: false });
    const wallet = await updateAgentWalletMetadata({ name, patch: { paused: true, fallbackApproval: "deny" } });
    const receipt = await addReceipt({
        kind: "agent_wallet_pause",
        status: "confirmed",
        network: NETWORK,
        chainId: CHAIN_ID,
        title: `Paused agent wallet ${name}`,
        summary: `${name} can no longer sign through low-value mode`,
        walletName: name,
        result: compactWallet(wallet),
    });
    return text({
        wallet: compactWallet(wallet),
        receipt,
        warning: "Low-value signing is disabled. Existing signed payloads in the outbox are not automatically invalidated.",
    });
});
server.tool("agent_wallet_drain", "Prepare and optionally sign a transfer that drains an agent wallet back to a principal or recovery address.", {
    name: z.string().min(1),
    to: z.string().describe("0x recipient address or exact addressbook contact name."),
    amount: z.string().optional().describe("LYTH amount. Omit to drain balance minus estimated fee."),
    passphrase: z.string().min(12).optional(),
    sign: z.boolean().optional().describe("Sign encrypted envelope. Default true."),
    broadcast: z.boolean().optional().describe("Broadcast signed envelope. Requires LYTH_MCP_ENABLE_SUBMIT=1."),
    confirm: z.literal("DRAIN_AGENT_WALLET"),
}, async ({ name, to, amount, passphrase, sign, broadcast }) => {
    const recipient = await resolveRecipient(to);
    if (!recipient) {
        return errorText("to must be a 0x wire address or exact addressbook contact name");
    }
    const endpoint = await firstReachableEndpoint();
    const wallet = (await listWallets()).find((item) => item.name === name);
    if (!wallet) {
        return errorText(`wallet '${name}' not found`);
    }
    const gasLimit = 21000n;
    let fee = 1000000000n;
    try {
        fee = parseQuantity(await rpcCall(endpoint, "eth_gasPrice", []));
    }
    catch {
        fee = 1000000000n;
    }
    const amountUnits = amount
        ? decimalToUnits(amount)
        : parseQuantity(await rpcCall(endpoint, "eth_getBalance", [wallet.address, "latest"])) - gasLimit * fee;
    if (amountUnits <= 0n) {
        return errorText("wallet balance is too low to drain after estimated fee");
    }
    const resolvedNonce = parseQuantity(await rpcCall(endpoint, "eth_getTransactionCount", [wallet.address, "latest"]));
    const shouldSign = sign ?? true;
    const encryptionKey = shouldSign
        ? encryptionKeyFromRpc(await rpcCall(endpoint, "lyth_getEncryptionKey", []))
        : undefined;
    const amountDecimal = unitsToDecimal(amountUnits);
    const built = await buildTransfer({
        walletName: name,
        to: recipient.address,
        amountUnits,
        chainId: CHAIN_ID,
        nonce: resolvedNonce,
        gasLimit,
        maxFeePerGas: fee,
        maxPriorityFeePerGas: fee,
        passphrase,
        encryptionKey,
        sign: shouldSign,
        allowLowValueSigning: false,
        allowLocalKeySigning: true,
    });
    if (shouldSign && !built.signed) {
        return errorText("drain signing requires a passphrase; low-value signing is disabled for drains");
    }
    const outboxEntry = built.signed
        ? await addOutboxEntry({
            network: NETWORK,
            chainId: CHAIN_ID,
            kind: "lyth_encrypted",
            method: "lyth_submitEncrypted",
            payloadHex: built.signed.encryptedEnvelopeHex,
            walletName: name,
            from: wallet.address,
            to: recipient.address,
            amount: amountDecimal,
            asset: "LYTH",
            nonce: toQuantity(resolvedNonce),
            note: "Created by agent_wallet_drain.",
        })
        : null;
    let submitted = null;
    let broadcastError = null;
    if (broadcast && built.signed) {
        if (!SUBMIT_ENABLED) {
            broadcastError = { endpoint, method: "lyth_submitEncrypted", message: "Broadcast disabled. Set LYTH_MCP_ENABLE_SUBMIT=1." };
        }
        else {
            try {
                const txHash = await submitPayload(endpoint, "lyth_encrypted", built.signed.encryptedEnvelopeHex);
                submitted = { endpoint, method: "lyth_submitEncrypted", txHash };
                if (outboxEntry) {
                    await recordOutboxAttempt(outboxEntry.id, { at: new Date().toISOString(), endpoint, method: "lyth_submitEncrypted", ok: true, txHash });
                }
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                broadcastError = { endpoint, method: "lyth_submitEncrypted", message };
                if (outboxEntry) {
                    await recordOutboxAttempt(outboxEntry.id, { at: new Date().toISOString(), endpoint, method: "lyth_submitEncrypted", ok: false, error: message });
                }
            }
        }
    }
    if (built.signed) {
        await configureLowValuePolicy({ name, enabled: false });
    }
    const paused = await updateAgentWalletMetadata({ name, patch: { paused: true, fallbackApproval: "deny" } });
    const receipt = await addReceipt({
        kind: "agent_wallet_drain",
        status: submitted ? "submitted" : broadcastError ? "failed" : built.signed ? "signed" : "drafted",
        network: NETWORK,
        chainId: CHAIN_ID,
        title: `Drain agent wallet ${name}`,
        summary: `${name} -> ${recipient.address} (${amountDecimal} LYTH)`,
        walletName: name,
        from: wallet.address,
        to: recipient.address,
        amount: amountDecimal,
        asset: "LYTH",
        outboxId: outboxEntry?.id,
        txHash: typeof submitted?.txHash === "string" ? submitted.txHash : undefined,
        payloadHash: outboxEntry?.payloadHash,
        endpoint,
        result: { submitted, wallet: compactWallet(paused) },
        error: broadcastError?.message,
    });
    return text({
        endpoint,
        recipient,
        wallet: compactWallet(paused),
        built,
        outbox: outboxEntry,
        submitted,
        broadcastError,
        receipt,
        warning: "Drain disables low-value signing and marks the wallet paused. Existing signed payloads in the outbox may still be valid.",
    });
});
server.tool("agent_wallet_delete", "Delete a local agent wallet record after explicit confirmation.", {
    name: z.string().min(1),
    confirmName: z.string().min(1).describe("Must exactly equal name."),
    confirm: z.literal("DELETE_AGENT_WALLET"),
}, async ({ name, confirmName }) => {
    const result = await deleteWallet(name, confirmName);
    const receipt = await addReceipt({
        kind: "agent_wallet_delete",
        status: "confirmed",
        network: NETWORK,
        chainId: CHAIN_ID,
        title: `Deleted agent wallet ${name}`,
        summary: `${name} removed from local MCP wallet store`,
        walletName: name,
        result,
    });
    return text({ ...result, receipt });
});
server.tool("addressbook_add", "Add or update a local MCP addressbook contact. Use this before sending to named contacts.", {
    name: z.string().min(1),
    address: z.string().describe("0x recipient address."),
    note: z.string().optional(),
    tags: z.array(z.string()).optional(),
    overwrite: z.boolean().optional().describe("Replace existing contact with the same name. Default true."),
}, async ({ name, address, note, tags, overwrite }) => {
    if (!isWireAddress(address)) {
        return errorText("address must be a 0x wire address");
    }
    return text(await upsertAddressbookContact({
        name,
        address,
        note,
        tags,
        overwrite,
    }));
});
server.tool("addressbook_lookup", "List or search local MCP addressbook contacts.", {
    query: z.string().optional().describe("Name, address, note, or tag filter. Omit to list all contacts."),
    limit: z.number().min(1).max(100).optional(),
}, async ({ query, limit }) => {
    const contacts = await listAddressbookContacts(query);
    return text({
        store: await addressbookInfo(),
        contacts: contacts.slice(0, limit ?? 25),
    });
});
server.tool("addressbook_remove", "Remove a local MCP addressbook contact by name.", {
    name: z.string().min(1),
}, async ({ name }) => text(await removeAddressbookContact(name)));
server.tool("wallet_configure_low_value", "Enable or disable no-passphrase low-value signing for a local agent wallet.", {
    name: z.string().min(1),
    enabled: z.boolean(),
    passphrase: z.string().min(12).optional().describe("Required when enabling, unless LYTH_MCP_WALLET_PASSPHRASE is set."),
    maxAmount: z.string().optional().describe("Max LYTH per no-passphrase transaction."),
    dailyLimit: z.string().optional().describe("Optional daily LYTH cap."),
}, async ({ name, enabled, passphrase, maxAmount, dailyLimit }) => {
    return text({
        wallet: await configureLowValuePolicy({ name, enabled, passphrase, maxAmount, dailyLimit }),
        warning: enabled
            ? "Low-value mode is a local hot-wallet mode. It is convenient, not cold-wallet security."
            : "Low-value mode disabled. Future signing requires passphrase.",
    });
});
server.tool("wallet_export_mnemonic", "Reveal a wallet mnemonic after passphrase decryption. Use only for backup; never paste it into chats or logs.", {
    name: z.string().min(1),
    passphrase: z.string().min(12).optional(),
    confirm: z.literal("REVEAL_MNEMONIC"),
}, async ({ name, passphrase }) => {
    return text({
        name,
        mnemonic: await exportMnemonic(name, passphrase),
        warning: "This mnemonic controls the wallet. Store it offline and do not share it.",
    });
});
server.tool("wallet_delete", "Delete a local MCP wallet from the wallet store.", {
    name: z.string().min(1),
    confirmName: z.string().min(1).describe("Must exactly equal name."),
}, async ({ name, confirmName }) => text(await deleteWallet(name, confirmName)));
server.tool("wallet_build_transfer", "Build a native LYTH transfer from a stored MCP wallet. Can sign with passphrase or low-value hot mode. Broadcast is optional and gated. If broadcast fails, retry the returned signed payload with submit_signed_transaction; do not rebuild.", {
    walletName: z.string().min(1),
    to: z.string().describe("0x recipient address or exact addressbook contact name."),
    amount: z.string().describe("LYTH amount, e.g. 1.5."),
    passphrase: z.string().min(12).optional().describe("Required above low-value cap or when low-value mode is disabled."),
    sign: z.boolean().optional().describe("Sign encrypted envelope. Default true."),
    allowLowValueSigning: z.boolean().optional().describe("Allow no-passphrase signing when within configured cap. Default true."),
    broadcast: z.boolean().optional().describe("Broadcast signed encrypted envelope. Requires LYTH_MCP_ENABLE_SUBMIT=1."),
    gasLimit: z.string().optional().describe("Hex or decimal gas limit. Default 21000."),
    maxFeePerGas: z.string().optional().describe("Hex or decimal fee. Defaults to eth_gasPrice or 1 gwei fallback."),
    maxPriorityFeePerGas: z.string().optional().describe("Hex or decimal priority fee. Defaults to maxFeePerGas."),
    nonce: z.string().optional().describe("Hex or decimal nonce. Defaults to live eth_getTransactionCount."),
}, async ({ walletName, to, amount, passphrase, sign, allowLowValueSigning, broadcast, gasLimit, maxFeePerGas, maxPriorityFeePerGas, nonce }) => {
    const recipient = await resolveRecipient(to);
    if (!recipient) {
        return errorText("to must be a 0x wire address or exact addressbook contact name");
    }
    const endpoint = await firstReachableEndpoint();
    const wallets = await listWallets();
    const wallet = wallets.find((w) => w.name === walletName);
    if (!wallet) {
        return errorText(`wallet '${walletName}' not found`);
    }
    const shouldSign = sign ?? true;
    const resolvedNonce = nonce ? parseFlexibleBigint(nonce) : parseQuantity(await rpcCall(endpoint, "eth_getTransactionCount", [wallet.address, "latest"]));
    let fee = maxFeePerGas ? parseFlexibleBigint(maxFeePerGas) : 1000000000n;
    if (!maxFeePerGas) {
        try {
            fee = parseQuantity(await rpcCall(endpoint, "eth_gasPrice", []));
        }
        catch {
            fee = 1000000000n;
        }
    }
    const priority = maxPriorityFeePerGas ? parseFlexibleBigint(maxPriorityFeePerGas) : fee;
    const encryptionKey = shouldSign
        ? encryptionKeyFromRpc(await rpcCall(endpoint, "lyth_getEncryptionKey", []))
        : undefined;
    const built = await buildTransfer({
        walletName,
        to: recipient.address,
        amountUnits: decimalToUnits(amount),
        chainId: CHAIN_ID,
        nonce: resolvedNonce,
        gasLimit: gasLimit ? parseFlexibleBigint(gasLimit) : 21000n,
        maxFeePerGas: fee,
        maxPriorityFeePerGas: priority,
        passphrase,
        encryptionKey,
        sign: shouldSign,
        allowLowValueSigning: shouldSign ? allowLowValueSigning ?? true : false,
    });
    if (shouldSign && !built.signed) {
        return errorText("sign=true but no passphrase was supplied and low-value signing is not configured for this wallet");
    }
    const outboxEntry = built.signed
        ? await addOutboxEntry({
            network: NETWORK,
            chainId: CHAIN_ID,
            kind: "lyth_encrypted",
            method: "lyth_submitEncrypted",
            payloadHex: built.signed.encryptedEnvelopeHex,
            walletName,
            from: wallet.address,
            to: recipient.address,
            amount,
            asset: "LYTH",
            nonce: toQuantity(resolvedNonce),
            policySnapshot: built.lowValuePolicy ?? wallet.lowValue,
            note: "Created by wallet_build_transfer. Retry this payload from the outbox instead of rebuilding after transient broadcast failure.",
        })
        : null;
    let submitted = null;
    let broadcastError = null;
    if (broadcast) {
        if (!SUBMIT_ENABLED) {
            broadcastError = {
                endpoint,
                method: "lyth_submitEncrypted",
                message: "Broadcast disabled. Set LYTH_MCP_ENABLE_SUBMIT=1 to allow wallet_build_transfer broadcast.",
            };
        }
        else if (!built.signed) {
            broadcastError = {
                endpoint,
                method: "lyth_submitEncrypted",
                message: "Cannot broadcast unsigned transfer",
            };
        }
        else {
            try {
                const txHash = await submitPayload(endpoint, "lyth_encrypted", built.signed.encryptedEnvelopeHex);
                submitted = {
                    endpoint,
                    method: "lyth_submitEncrypted",
                    txHash,
                };
                if (outboxEntry) {
                    await recordOutboxAttempt(outboxEntry.id, {
                        at: new Date().toISOString(),
                        endpoint,
                        method: "lyth_submitEncrypted",
                        ok: true,
                        txHash,
                    });
                }
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                broadcastError = {
                    endpoint,
                    method: "lyth_submitEncrypted",
                    message,
                };
                if (outboxEntry) {
                    await recordOutboxAttempt(outboxEntry.id, {
                        at: new Date().toISOString(),
                        endpoint,
                        method: "lyth_submitEncrypted",
                        ok: false,
                        error: message,
                    });
                }
            }
        }
    }
    const receipt = await addReceipt({
        kind: "wallet_transfer",
        status: submitted ? "submitted" : broadcastError ? "failed" : built.signed ? "signed" : "drafted",
        network: NETWORK,
        chainId: CHAIN_ID,
        title: `Transfer ${amount} LYTH to ${recipient.contact?.name ?? short(recipient.address)}`,
        summary: `${walletName} -> ${recipient.address} (${amount} LYTH)`,
        walletName,
        from: wallet.address,
        to: recipient.address,
        amount,
        asset: "LYTH",
        outboxId: outboxEntry?.id,
        txHash: typeof submitted?.txHash === "string" ? submitted.txHash : undefined,
        payloadHash: outboxEntry?.payloadHash,
        endpoint,
        result: submitted ?? { signed: Boolean(built.signed), broadcastRequested: Boolean(broadcast) },
        error: broadcastError?.message,
    });
    return text({
        endpoint,
        recipient,
        built,
        outbox: outboxEntry,
        receipt,
        submitted,
        broadcastError,
        broadcastEnabled: SUBMIT_ENABLED,
        retry: built.signed
            ? {
                tool: outboxEntry ? "tx_outbox_retry" : "submit_signed_transaction",
                arguments: {
                    ...(outboxEntry
                        ? { id: outboxEntry.id }
                        : {
                            kind: "lyth_encrypted",
                            payloadHex: built.signed.encryptedEnvelopeHex,
                        }),
                },
                warning: "If broadcast failed, retry this exact signed payload. Do not call wallet_build_transfer again unless you intentionally want a new signed transfer and a new low-value allowance reservation.",
            }
            : null,
        lowValueAccounting: built.lowValuePolicy?.used
            ? "Low-value allowance is reserved when the signed payload is created, not when broadcast succeeds, because a signed payload can be submitted later."
            : "No low-value allowance was reserved for this build.",
    });
});
server.tool("account_overview", "Get live account balance, nonce, profile, and recent flow for a Monolythium address.", {
    address: z.string().describe("0x wire address or mono1 display address. Some RPC readers may require 0x."),
    flowLimit: z.number().min(1).max(250).optional().describe("Address flow sample size, default 25."),
}, async ({ address, flowLimit }) => {
    const endpoint = await firstReachableEndpoint();
    const [balance, nonce, profile, flow, label] = await Promise.allSettled([
        rpcCall(endpoint, "eth_getBalance", [address, "latest"]),
        rpcCall(endpoint, "eth_getTransactionCount", [address, "latest"]),
        rpcCall(endpoint, "lyth_addressProfile", [address]),
        rpcCall(endpoint, "lyth_addressFlow", [address, flowLimit ?? 25]),
        rpcCall(endpoint, "lyth_getAddressLabel", [address]),
    ]);
    return text({
        network: NETWORK,
        chainId: CHAIN_ID,
        endpoint,
        address,
        balance: balance.status === "fulfilled" ? balance.value : { error: balance.reason?.message ?? String(balance.reason) },
        nonce: nonce.status === "fulfilled" ? parseQuantity(nonce.value).toString() : { error: nonce.reason?.message ?? String(nonce.reason) },
        profile: profile.status === "fulfilled" ? profile.value : { error: profile.reason?.message ?? String(profile.reason) },
        flow: flow.status === "fulfilled" ? flow.value : { error: flow.reason?.message ?? String(flow.reason) },
        label: label.status === "fulfilled" ? label.value : { error: label.reason?.message ?? String(label.reason) },
    });
});
server.tool("recent_transactions", "Get recent live transactions from lyth_txFeed.", {
    limit: z.number().min(1).max(100).optional().describe("Number of transactions, default 25."),
    cursor: z.string().optional().describe("Optional feed cursor."),
}, async ({ limit, cursor }) => {
    const endpoint = await firstReachableEndpoint();
    const params = cursor ? [limit ?? 25, cursor] : [limit ?? 25];
    return text(await rpcCall(endpoint, "lyth_txFeed", params));
});
server.tool("tx_lookup", "Look up a transaction by hash, including status, receipt, decoded view, and raw transaction where available.", { txHash: z.string().describe("0x transaction hash") }, async ({ txHash }) => {
    if (!isHex(txHash)) {
        return errorText("txHash must be 0x-prefixed hex");
    }
    const endpoint = await firstReachableEndpoint();
    const [status, receipt, tx, decoded] = await Promise.allSettled([
        rpcCall(endpoint, "lyth_txStatus", [txHash]),
        rpcCall(endpoint, "eth_getTransactionReceipt", [txHash]),
        rpcCall(endpoint, "eth_getTransactionByHash", [txHash]),
        rpcCall(endpoint, "lyth_decodeTx", [txHash]),
    ]);
    return text({
        txHash,
        endpoint,
        status: status.status === "fulfilled" ? status.value : { error: status.reason?.message ?? String(status.reason) },
        receipt: receipt.status === "fulfilled" ? receipt.value : { error: receipt.reason?.message ?? String(receipt.reason) },
        transaction: tx.status === "fulfilled" ? tx.value : { error: tx.reason?.message ?? String(tx.reason) },
        decoded: decoded.status === "fulfilled" ? decoded.value : { error: decoded.reason?.message ?? String(decoded.reason) },
    });
});
server.tool("search_chain", "Search live chain data for addresses, hashes, blocks, clusters, or labels.", {
    query: z.string(),
    limit: z.number().min(1).max(50).optional(),
}, async ({ query, limit }) => {
    const endpoint = await firstReachableEndpoint();
    return text(await rpcCall(endpoint, "lyth_search", [query, limit ?? 10]));
});
server.tool("markets", "Read live CLOB markets and optional market details/order book/trades.", {
    limit: z.number().min(1).max(100).optional(),
    marketId: z.string().optional(),
    includeBook: z.boolean().optional(),
    includeTrades: z.boolean().optional(),
}, async ({ limit, marketId, includeBook, includeTrades }) => {
    const endpoint = await firstReachableEndpoint();
    if (!marketId) {
        return text(await rpcCall(endpoint, "lyth_clobMarkets", [limit ?? 25]));
    }
    const [market, book, trades] = await Promise.allSettled([
        rpcCall(endpoint, "lyth_clobMarket", [marketId]),
        includeBook ? rpcCall(endpoint, "lyth_clobOrderBook", [marketId, 20]) : Promise.resolve(null),
        includeTrades ? rpcCall(endpoint, "lyth_clobTrades", [marketId, limit ?? 25]) : Promise.resolve(null),
    ]);
    return text({
        marketId,
        market: market.status === "fulfilled" ? market.value : { error: market.reason?.message ?? String(market.reason) },
        orderBook: book.status === "fulfilled" ? book.value : { error: book.reason?.message ?? String(book.reason) },
        trades: trades.status === "fulfilled" ? trades.value : { error: trades.reason?.message ?? String(trades.reason) },
    });
});
server.tool("list_runbooks", "List supported AI runbooks and their live-readiness status.", {}, async () => {
    return text({
        network: NETWORK,
        chainId: CHAIN_ID,
        runbooks: runbookCatalogue(),
        safety: {
            walletStorage: "optional local encrypted MCP wallet store; no plaintext keys or mnemonics",
            approval: "all economic actions require wallet/user approval",
            broadcasting: SUBMIT_ENABLED ? "enabled by env" : "disabled; set LYTH_MCP_ENABLE_SUBMIT=1 to enable signed-envelope broadcast",
        },
    });
});
server.tool("draft_runbook", "Draft a typed AI runbook for payment, booking, escrow, trading, policy, receipt, or vendor-rating workflows.", {
    runbook: runbookEnum,
    fields: recordSchema.describe("Runbook-specific fields such as recipient, amount, asset, vendorId, service, marketId."),
    policy: policySchema.describe("Optional spending policy constraints to evaluate while drafting."),
    agent: recordSchema.describe("Optional agent identity metadata."),
    principal: recordSchema.describe("Optional human or organization principal metadata."),
}, async (args) => text(buildRunbookDraft(args)));
server.tool("validate_runbook", "Validate a drafted runbook against spending-policy and MCP safety rules.", {
    runbook: runbookEnum,
    fields: recordSchema,
    policy: policySchema,
    agent: recordSchema,
    principal: recordSchema,
}, async (args) => {
    const draft = buildRunbookDraft(args);
    return text({ draft, validation: validateRunbook(draft) });
});
server.tool("prepare_wallet_request", "Prepare a wallet approval payload from a runbook. MVP supports native LYTH pay_vendor transfers.", {
    runbook: runbookEnum,
    from: z.string().optional().describe("0x sender address required for live wallet payloads."),
    fields: recordSchema,
    policy: policySchema,
    agent: recordSchema,
    principal: recordSchema,
}, async ({ from, ...args }) => {
    const draft = buildRunbookDraft(args);
    return text({ draft, prepared: prepareWalletRequest(draft, from) });
});
server.tool("submit_signed_transaction", "Broadcast an already-signed transaction/envelope. Disabled unless LYTH_MCP_ENABLE_SUBMIT=1. This tool never signs.", {
    kind: z.enum(["eth_raw", "lyth_encrypted"]).describe("eth_raw uses eth_sendRawTransaction; lyth_encrypted uses lyth_submitEncrypted."),
    payloadHex: z.string().describe("0x-prefixed signed raw transaction or encrypted envelope hex."),
    outboxId: z.string().optional().describe("Optional local outbox id to update with the broadcast attempt."),
}, async ({ kind, payloadHex, outboxId }) => {
    if (!isHex(payloadHex)) {
        return errorText("payloadHex must be 0x-prefixed hex");
    }
    if (!SUBMIT_ENABLED) {
        return errorText("Broadcast disabled. Set LYTH_MCP_ENABLE_SUBMIT=1 to allow this MCP to submit already-signed payloads.");
    }
    const endpoint = await firstReachableEndpoint();
    const method = kind === "eth_raw" ? "eth_sendRawTransaction" : "lyth_submitEncrypted";
    try {
        const txHash = await rpcCall(endpoint, method, [payloadHex]);
        const outbox = outboxId
            ? await recordOutboxAttempt(outboxId, { at: new Date().toISOString(), endpoint, method, ok: true, txHash })
            : null;
        const receipt = await addReceipt({
            kind: "submit_signed_transaction",
            status: "submitted",
            network: NETWORK,
            chainId: CHAIN_ID,
            title: "Submitted signed transaction",
            summary: `${method} -> ${txHash}`,
            outboxId,
            txHash,
            endpoint,
            result: { method, txHash },
        });
        return text({ endpoint, method, txHash, outbox, receipt });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const outbox = outboxId
            ? await recordOutboxAttempt(outboxId, { at: new Date().toISOString(), endpoint, method, ok: false, error: message })
            : null;
        const receipt = await addReceipt({
            kind: "submit_signed_transaction",
            status: "failed",
            network: NETWORK,
            chainId: CHAIN_ID,
            title: "Failed signed transaction submission",
            summary: `${method} failed`,
            outboxId,
            endpoint,
            error: message,
        });
        return text({ endpoint, method, outbox, receipt, error: message });
    }
});
server.tool("tx_outbox_list", "List local signed payloads that can be retried without rebuilding/re-signing.", {
    status: outboxStatusEnum.optional(),
    walletName: z.string().optional(),
    limit: z.number().min(1).max(100).optional(),
}, async ({ status, walletName, limit }) => text({
    store: await outboxInfo(),
    entries: await listOutboxEntries({ status: status, walletName, limit }),
}));
server.tool("tx_outbox_get", "Get a local outbox entry by id.", { id: z.string().min(1) }, async ({ id }) => text(await getOutboxEntry(id)));
server.tool("tx_outbox_retry", "Retry a signed payload from the local outbox. Requires LYTH_MCP_ENABLE_SUBMIT=1.", { id: z.string().min(1) }, async ({ id }) => {
    const entry = await getOutboxEntry(id);
    if (!SUBMIT_ENABLED) {
        return errorText("Broadcast disabled. Set LYTH_MCP_ENABLE_SUBMIT=1 to retry outbox payloads.");
    }
    const endpoint = await firstReachableEndpoint();
    const method = outboxMethod(entry.kind);
    try {
        const txHash = await submitPayload(endpoint, entry.kind, entry.payloadHex);
        const outbox = await recordOutboxAttempt(id, { at: new Date().toISOString(), endpoint, method, ok: true, txHash });
        const receipt = await addReceipt({
            kind: "tx_outbox_retry",
            status: "submitted",
            network: NETWORK,
            chainId: CHAIN_ID,
            title: `Retried outbox ${id}`,
            summary: `${method} -> ${txHash}`,
            walletName: entry.walletName,
            from: entry.from,
            to: entry.to,
            amount: entry.amount,
            asset: entry.asset,
            outboxId: id,
            txHash,
            payloadHash: entry.payloadHash,
            endpoint,
            result: { method, txHash },
        });
        return text({ endpoint, method, txHash, outbox, receipt });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const outbox = await recordOutboxAttempt(id, { at: new Date().toISOString(), endpoint, method, ok: false, error: message });
        const receipt = await addReceipt({
            kind: "tx_outbox_retry",
            status: "failed",
            network: NETWORK,
            chainId: CHAIN_ID,
            title: `Failed retry for outbox ${id}`,
            summary: `${method} failed`,
            walletName: entry.walletName,
            from: entry.from,
            to: entry.to,
            amount: entry.amount,
            asset: entry.asset,
            outboxId: id,
            payloadHash: entry.payloadHash,
            endpoint,
            error: message,
        });
        return text({ endpoint, method, outbox, receipt, error: message });
    }
});
server.tool("tx_outbox_forget", "Remove a local outbox entry. This does not invalidate an already-signed payload.", {
    id: z.string().min(1),
    confirm: z.literal("FORGET_SIGNED_PAYLOAD"),
}, async ({ id }) => text({
    ...(await forgetOutboxEntry(id)),
    warning: "Forgetting removes the local record only. It cannot invalidate a signed payload that was copied elsewhere.",
}));
server.tool("tx_status_summary", "Summarize live transaction status by tx hash or local outbox id.", {
    txHash: z.string().optional(),
    outboxId: z.string().optional(),
}, async ({ txHash, outboxId }) => {
    if (!txHash && !outboxId) {
        return errorText("txHash or outboxId is required");
    }
    return text(await txStatusSummary({ txHash, outboxId }));
});
server.tool("receipt_list", "List local MCP receipts for drafted, signed, submitted, confirmed, or failed operations.", {
    status: receiptStatusEnum.optional(),
    kind: z.string().optional(),
    walletName: z.string().optional(),
    limit: z.number().min(1).max(100).optional(),
}, async ({ status, kind, walletName, limit }) => text({
    store: await receiptInfo(),
    receipts: await listReceipts({ status: status, kind, walletName, limit }),
}));
server.tool("receipt_get", "Get one local MCP receipt by id.", { id: z.string().min(1) }, async ({ id }) => text(await getReceipt(id)));
server.tool("receipt_export", "Export a local MCP receipt as JSON.", { id: z.string().min(1) }, async ({ id }) => text({
    receipt: await getReceipt(id),
    format: "json",
}));
server.tool("mcp_dashboard", "Render a compact Markdown dashboard for Claude Code or other text UIs.", {
    includeEntries: z.boolean().optional().describe("Include recent outbox/receipt rows. Default true."),
}, async ({ includeEntries }) => {
    const wallets = await listWallets();
    const outbox = await listOutboxEntries({ limit: 10 });
    const receipts = await listReceipts({ limit: 10 });
    const contacts = await listAddressbookContacts();
    const walletInfo = await walletStoreInfo();
    const contactInfo = await addressbookInfo();
    const outboxStore = await outboxInfo();
    const receiptStore = await receiptInfo();
    const lines = [
        "# Lyth MCP Dashboard",
        "",
        `Network: ${NETWORK} (${CHAIN_ID})`,
        `Broadcast: ${SUBMIT_ENABLED ? "enabled" : "disabled"}`,
        "",
        mdTable(["Store", "Count", "Path"], [
            ["Wallets", String(wallets.length), walletInfo.path],
            ["Contacts", String(contacts.length), contactInfo.path],
            ["Outbox", String(outboxStore.entryCount), outboxStore.path],
            ["Receipts", String(receiptStore.receiptCount), receiptStore.path],
        ]),
        "",
        "## Wallets",
        wallets.length
            ? mdTable(["Name", "Address", "Mode", "Cap", "Daily", "Paused", "Purpose"], wallets.map((wallet) => {
                const low = wallet.lowValue;
                const agent = wallet.agent;
                return [
                    wallet.name,
                    short(wallet.address),
                    wallet.keyProtection,
                    low?.maxAmount ?? "",
                    low?.dailyLimit ?? "",
                    agent?.paused ? "yes" : "no",
                    agent?.purpose ?? "",
                ];
            }))
            : "No wallets.",
    ];
    if (includeEntries !== false) {
        lines.push("", "## Outbox", outbox.length
            ? mdTable(["ID", "Status", "Wallet", "To", "Amount", "Tx"], outbox.map((entry) => [
                entry.id,
                entry.status,
                entry.walletName ?? "",
                short(entry.to),
                entry.amount ? `${entry.amount} ${entry.asset ?? ""}` : "",
                short(entry.txHash),
            ]))
            : "No outbox entries.", "", "## Receipts", receipts.length
            ? mdTable(["ID", "Status", "Kind", "Summary"], receipts.map((receipt) => [
                receipt.id,
                receipt.status,
                receipt.kind,
                receipt.summary,
            ]))
            : "No receipts.");
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
});
server.tool("vendor_search", "Search the local vendor registry used by agent runbooks. Set LYTH_MCP_VENDOR_REGISTRY to a JSON file.", {
    query: z.string().optional(),
    category: z.string().optional(),
    limit: z.number().min(1).max(50).optional(),
}, async ({ query, category, limit }) => {
    const registry = await loadVendors();
    const q = query?.toLowerCase();
    const c = category?.toLowerCase();
    const vendors = registry.vendors
        .filter((vendor) => {
        const haystack = safeStringify(vendor).toLowerCase();
        return (!q || haystack.includes(q)) && (!c || String(vendor.category ?? "").toLowerCase() === c);
    })
        .slice(0, limit ?? 10);
    return text({ ...registry, vendors });
});
server.tool("api_get", "Low-level read-only helper for the node /api/v1 surface. Use when a higher-level tool is missing.", {
    path: z.string().describe("Path under /api/v1, e.g. health, stats, blocks/latest."),
    query: z.record(z.union([z.string(), z.number()])).optional(),
}, async ({ path, query }) => {
    const endpoint = await firstReachableEndpoint();
    return text(await apiGet(endpoint, path, query));
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    console.error("lyth-mcp fatal:", err);
    process.exit(1);
});
