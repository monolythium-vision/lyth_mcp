import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
const STORE_VERSION = 1;
export function outboxPath() {
    return process.env.LYTH_MCP_OUTBOX || join(homedir(), ".lyth_mcp", "outbox.json");
}
export async function readOutbox(path = outboxPath()) {
    try {
        const raw = await readFile(path, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.schemaVersion !== STORE_VERSION || !Array.isArray(parsed.entries)) {
            throw new Error(`unsupported outbox shape at ${path}`);
        }
        return parsed;
    }
    catch (err) {
        if (err.code === "ENOENT") {
            return { schemaVersion: STORE_VERSION, entries: [] };
        }
        throw err;
    }
}
export async function writeOutbox(store, path = outboxPath()) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, path);
}
export async function outboxInfo(path = outboxPath()) {
    const store = await readOutbox(path);
    let mode = null;
    try {
        mode = `0${(await stat(path)).mode.toString(8).slice(-3)}`;
    }
    catch {
        mode = null;
    }
    return {
        path,
        entryCount: store.entries.length,
        fileMode: mode,
    };
}
export async function addOutboxEntry(args) {
    const now = new Date().toISOString();
    const entry = {
        ...args,
        id: args.id ?? `outbox_${Date.now()}_${randomUUID().slice(0, 8)}`,
        status: args.status ?? "signed",
        payloadHash: payloadHash(args.payloadHex),
        createdAt: now,
        updatedAt: now,
        attempts: args.attempts ?? [],
    };
    const store = await readOutbox();
    store.entries.unshift(entry);
    await writeOutbox(store);
    return entry;
}
export async function listOutboxEntries(args = {}) {
    const entries = (await readOutbox()).entries;
    return entries
        .filter((entry) => !args.status || entry.status === args.status)
        .filter((entry) => !args.walletName || entry.walletName === args.walletName)
        .slice(0, args.limit ?? 50);
}
export async function getOutboxEntry(id) {
    const entry = (await readOutbox()).entries.find((item) => item.id === id);
    if (!entry) {
        throw new Error(`outbox entry '${id}' not found`);
    }
    return entry;
}
export async function recordOutboxAttempt(id, attempt) {
    const store = await readOutbox();
    const index = store.entries.findIndex((entry) => entry.id === id);
    if (index < 0) {
        throw new Error(`outbox entry '${id}' not found`);
    }
    const entry = store.entries[index];
    entry.attempts.unshift(attempt);
    entry.updatedAt = attempt.at;
    if (attempt.ok && attempt.txHash) {
        entry.status = "submitted";
        entry.txHash = attempt.txHash;
    }
    store.entries[index] = entry;
    await writeOutbox(store);
    return entry;
}
export async function updateOutboxStatus(id, status, txHash) {
    const store = await readOutbox();
    const index = store.entries.findIndex((entry) => entry.id === id);
    if (index < 0) {
        throw new Error(`outbox entry '${id}' not found`);
    }
    const entry = store.entries[index];
    entry.status = status;
    entry.txHash = txHash ?? entry.txHash;
    entry.updatedAt = new Date().toISOString();
    store.entries[index] = entry;
    await writeOutbox(store);
    return entry;
}
export async function forgetOutboxEntry(id) {
    const store = await readOutbox();
    const next = store.entries.filter((entry) => entry.id !== id);
    if (next.length === store.entries.length) {
        throw new Error(`outbox entry '${id}' not found`);
    }
    await writeOutbox({ schemaVersion: STORE_VERSION, entries: next });
    return { removed: true, path: outboxPath() };
}
function payloadHash(payloadHex) {
    return `sha256:${createHash("sha256").update(payloadHex).digest("hex")}`;
}
