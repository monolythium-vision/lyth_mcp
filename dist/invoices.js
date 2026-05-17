import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
const STORE_VERSION = 1;
export function invoiceStorePath() {
    return process.env.LYTH_MCP_INVOICE_STORE || join(homedir(), ".lyth_mcp", "invoices.json");
}
export async function readInvoiceStore(path = invoiceStorePath()) {
    try {
        const raw = await readFile(path, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.schemaVersion !== STORE_VERSION || !Array.isArray(parsed.invoices)) {
            throw new Error(`unsupported invoice store shape at ${path}`);
        }
        return parsed;
    }
    catch (err) {
        if (err.code === "ENOENT") {
            return { schemaVersion: STORE_VERSION, invoices: [] };
        }
        throw err;
    }
}
export async function writeInvoiceStore(store, path = invoiceStorePath()) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, path);
}
export async function invoiceStoreInfo(path = invoiceStorePath()) {
    const store = await readInvoiceStore(path);
    let mode = null;
    try {
        mode = `0${(await stat(path)).mode.toString(8).slice(-3)}`;
    }
    catch {
        mode = null;
    }
    return {
        path,
        invoiceCount: store.invoices.length,
        fileMode: mode,
    };
}
export async function createInvoice(args) {
    const now = new Date().toISOString();
    const invoice = {
        ...args,
        id: `${args.type}_${Date.now()}_${randomUUID().slice(0, 8)}`,
        status: isExpired(args.expiresAt) ? "expired" : "open",
        createdAt: now,
        updatedAt: now,
        events: [{ at: now, type: "created" }],
    };
    const store = await readInvoiceStore();
    store.invoices.unshift(invoice);
    await writeInvoiceStore(store);
    return invoice;
}
export async function getInvoice(id) {
    const invoice = (await readInvoiceStore()).invoices.find((item) => item.id === id);
    if (!invoice) {
        throw new Error(`invoice '${id}' not found`);
    }
    return normalizeInvoiceStatus(invoice);
}
export async function listInvoices(args = {}) {
    const store = await readInvoiceStore();
    const normalized = store.invoices.map(normalizeInvoiceStatus);
    if (JSON.stringify(normalized) !== JSON.stringify(store.invoices)) {
        await writeInvoiceStore({ schemaVersion: STORE_VERSION, invoices: normalized });
    }
    return normalized
        .filter((invoice) => !args.status || invoice.status === args.status)
        .filter((invoice) => !args.type || invoice.type === args.type)
        .slice(0, args.limit ?? 50);
}
export async function updateInvoice(id, patch, eventType, data) {
    const store = await readInvoiceStore();
    const index = store.invoices.findIndex((invoice) => invoice.id === id);
    if (index < 0) {
        throw new Error(`invoice '${id}' not found`);
    }
    const now = new Date().toISOString();
    const current = normalizeInvoiceStatus(store.invoices[index]);
    const next = normalizeInvoiceStatus({
        ...current,
        ...patch,
        updatedAt: now,
        events: [{ at: now, type: eventType, data }, ...current.events],
    });
    store.invoices[index] = next;
    await writeInvoiceStore(store);
    return next;
}
function normalizeInvoiceStatus(invoice) {
    if (invoice.status === "open" && isExpired(invoice.expiresAt)) {
        return { ...invoice, status: "expired" };
    }
    return invoice;
}
function isExpired(expiresAt) {
    return Boolean(expiresAt && Date.parse(expiresAt) <= Date.now());
}
