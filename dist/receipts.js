import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
const STORE_VERSION = 1;
export function receiptPath() {
    return process.env.LYTH_MCP_RECEIPTS || join(homedir(), ".lyth_mcp", "receipts.json");
}
export async function readReceipts(path = receiptPath()) {
    try {
        const raw = await readFile(path, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.schemaVersion !== STORE_VERSION || !Array.isArray(parsed.receipts)) {
            throw new Error(`unsupported receipt store shape at ${path}`);
        }
        return parsed;
    }
    catch (err) {
        if (err.code === "ENOENT") {
            return { schemaVersion: STORE_VERSION, receipts: [] };
        }
        throw err;
    }
}
export async function writeReceipts(store, path = receiptPath()) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, path);
}
export async function receiptInfo(path = receiptPath()) {
    const store = await readReceipts(path);
    let mode = null;
    try {
        mode = `0${(await stat(path)).mode.toString(8).slice(-3)}`;
    }
    catch {
        mode = null;
    }
    return {
        path,
        receiptCount: store.receipts.length,
        fileMode: mode,
    };
}
export async function addReceipt(args) {
    const now = new Date().toISOString();
    const receipt = {
        ...args,
        id: args.id ?? `receipt_${Date.now()}_${randomUUID().slice(0, 8)}`,
        createdAt: now,
        updatedAt: now,
    };
    const store = await readReceipts();
    store.receipts.unshift(receipt);
    await writeReceipts(store);
    return receipt;
}
export async function listReceipts(args = {}) {
    const receipts = (await readReceipts()).receipts;
    return receipts
        .filter((receipt) => !args.status || receipt.status === args.status)
        .filter((receipt) => !args.kind || receipt.kind === args.kind)
        .filter((receipt) => !args.walletName || receipt.walletName === args.walletName)
        .slice(0, args.limit ?? 50);
}
export async function getReceipt(id) {
    const receipt = (await readReceipts()).receipts.find((item) => item.id === id);
    if (!receipt) {
        throw new Error(`receipt '${id}' not found`);
    }
    return receipt;
}
