import { createHash, verify as verifySignature } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { canonicalize } from "./runbooks.js";
export async function loadVendorRegistry(path) {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    const registry = Array.isArray(parsed)
        ? { vendors: parsed }
        : parsed;
    if (!Array.isArray(registry.vendors)) {
        throw new Error("vendor registry must be an array or an object with a vendors array");
    }
    const stats = await stat(path);
    const canonicalContent = canonicalize(registry);
    const payload = registryPayload(registry);
    const canonicalPayload = canonicalize(payload);
    return {
        source: path,
        registry,
        contentHash: `sha256:${createHash("sha256").update(canonicalContent).digest("hex")}`,
        payloadHash: `sha256:${createHash("sha256").update(canonicalPayload).digest("hex")}`,
        bytes: Buffer.byteLength(raw),
        updatedAt: stats.mtime.toISOString(),
        signatureStatus: verifyRegistrySignature(registry, canonicalPayload),
    };
}
export function vendorRegistrySummary(loaded) {
    const categories = [...new Set(loaded.registry.vendors.map((vendor) => vendor.category).filter(Boolean))].sort();
    return {
        source: loaded.source,
        schemaVersion: loaded.registry.schemaVersion,
        network: loaded.registry.network,
        issuer: loaded.registry.issuer,
        expiresAt: loaded.registry.expiresAt,
        disclaimer: loaded.registry.disclaimer,
        contentHash: loaded.contentHash,
        payloadHash: loaded.payloadHash,
        bytes: loaded.bytes,
        updatedAt: loaded.updatedAt,
        signatureStatus: loaded.signatureStatus,
        vendorCount: loaded.registry.vendors.length,
        categories,
    };
}
export function searchVendors(registry, args = {}) {
    const q = args.query?.toLowerCase();
    const c = args.category?.toLowerCase();
    return registry.vendors
        .filter((vendor) => {
        const haystack = canonicalize(vendor).toLowerCase();
        return (!q || haystack.includes(q)) && (!c || String(vendor.category ?? "").toLowerCase() === c);
    })
        .slice(0, args.limit ?? 10);
}
export function getVendor(registry, vendorId) {
    const vendor = registry.vendors.find((item) => item.id === vendorId);
    if (!vendor) {
        throw new Error(`vendor '${vendorId}' not found`);
    }
    return vendor;
}
export function quoteVendorOrder(args) {
    const quantity = args.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error("quantity must be a positive integer");
    }
    const item = args.itemId
        ? args.vendor.catalog?.find((entry) => entry.id === args.itemId)
        : args.vendor.catalog?.[0];
    if (args.itemId && !item) {
        throw new Error(`catalog item '${args.itemId}' not found for vendor '${args.vendor.id}'`);
    }
    const asset = String(args.asset ?? item?.asset ?? args.vendor.acceptedAssets?.[0] ?? "LYTH").toUpperCase();
    const warnings = [];
    if (args.vendor.acceptedAssets && !args.vendor.acceptedAssets.map((value) => value.toUpperCase()).includes(asset)) {
        warnings.push(`Vendor does not list ${asset} as an accepted asset.`);
    }
    const unitPrice = item?.price ?? "0";
    const amount = multiplyDecimal(unitPrice, quantity);
    if (args.vendor.maxOrderAmount && compareDecimal(amount, args.vendor.maxOrderAmount) > 0) {
        warnings.push(`Quote amount ${amount} exceeds vendor maxOrderAmount ${args.vendor.maxOrderAmount}.`);
    }
    const requiredFulfillmentFields = args.vendor.fulfillment?.requiredFields ?? [];
    const fulfillmentFields = args.fulfillmentFields ?? {};
    const missingFulfillmentFields = requiredFulfillmentFields.filter((field) => {
        const value = fulfillmentFields[field];
        return value === undefined || value === null || value === "";
    });
    if (missingFulfillmentFields.length > 0) {
        warnings.push(`Missing fulfillment fields: ${missingFulfillmentFields.join(", ")}.`);
    }
    if (args.vendor.fulfillment?.type?.includes("demo")) {
        warnings.push("Vendor fulfillment is demo-only; no real goods or services will be delivered.");
    }
    return {
        vendorId: args.vendor.id,
        vendorDisplayName: args.vendor.displayName,
        vendorAddress: args.vendor.address,
        itemId: item?.id,
        itemName: item?.name,
        quantity,
        amount,
        asset,
        fulfillmentType: args.vendor.fulfillment?.type,
        requiredFulfillmentFields,
        missingFulfillmentFields,
        warnings,
        registryHash: args.registryHash,
    };
}
function verifyRegistrySignature(registry, canonicalPayload) {
    const expired = Boolean(registry.expiresAt && Date.parse(registry.expiresAt) <= Date.now());
    const signature = registry.signature ?? registry.signatures?.[0];
    if (!signature) {
        return {
            status: "unsigned",
            reason: "Registry has no signature metadata.",
            expired,
            expiresAt: registry.expiresAt,
        };
    }
    if (signature.algorithm !== "ed25519" || !signature.publicKeyPem || !signature.signatureBase64) {
        return {
            status: "present_unverified",
            reason: "Signature metadata is present but unsupported or incomplete. Supported format: ed25519 + publicKeyPem + signatureBase64.",
            expired,
            expiresAt: registry.expiresAt,
        };
    }
    try {
        const ok = verifySignature(null, Buffer.from(canonicalPayload), signature.publicKeyPem, Buffer.from(signature.signatureBase64, "base64"));
        return {
            status: ok ? "verified" : "invalid",
            reason: ok ? "Registry signature verified." : "Registry signature did not verify.",
            expired,
            expiresAt: registry.expiresAt,
        };
    }
    catch (err) {
        return {
            status: "invalid",
            reason: err instanceof Error ? err.message : String(err),
            expired,
            expiresAt: registry.expiresAt,
        };
    }
}
function registryPayload(registry) {
    const { signature: _signature, signatures: _signatures, ...payload } = registry;
    return payload;
}
function multiplyDecimal(value, multiplier) {
    return unitsToDecimal(decimalToUnits(value) * BigInt(multiplier));
}
function compareDecimal(a, b) {
    const aa = decimalToUnits(a);
    const bb = decimalToUnits(b);
    return aa === bb ? 0 : aa > bb ? 1 : -1;
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
function unitsToDecimal(value, decimals = 18) {
    const sign = value < 0n ? "-" : "";
    const raw = (value < 0n ? -value : value).toString().padStart(decimals + 1, "0");
    const whole = raw.slice(0, -decimals);
    const frac = raw.slice(-decimals).replace(/0+$/, "");
    return `${sign}${whole}${frac ? `.${frac}` : ""}`;
}
