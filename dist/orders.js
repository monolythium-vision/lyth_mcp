import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
const STORE_VERSION = 1;
export function orderStorePath() {
    return process.env.LYTH_MCP_ORDER_STORE || join(homedir(), ".lyth_mcp", "orders.json");
}
export async function readOrderStore(path = orderStorePath()) {
    try {
        const raw = await readFile(path, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.schemaVersion !== STORE_VERSION || !Array.isArray(parsed.orders)) {
            throw new Error(`unsupported order store shape at ${path}`);
        }
        return parsed;
    }
    catch (err) {
        if (err.code === "ENOENT") {
            return { schemaVersion: STORE_VERSION, orders: [] };
        }
        throw err;
    }
}
export async function writeOrderStore(store, path = orderStorePath()) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, path);
}
export async function orderStoreInfo(path = orderStorePath()) {
    const store = await readOrderStore(path);
    let mode = null;
    try {
        mode = `0${(await stat(path)).mode.toString(8).slice(-3)}`;
    }
    catch {
        mode = null;
    }
    return {
        path,
        orderCount: store.orders.length,
        fileMode: mode,
    };
}
export async function createOrder(args) {
    const now = new Date().toISOString();
    const order = {
        ...args,
        id: `order_${Date.now()}_${randomUUID().slice(0, 8)}`,
        status: "created",
        createdAt: now,
        updatedAt: now,
        events: [{ at: now, type: "created", data: args.quote }],
    };
    const store = await readOrderStore();
    store.orders.unshift(order);
    await writeOrderStore(store);
    return order;
}
export async function listOrders(args = {}) {
    const orders = (await readOrderStore()).orders;
    return orders
        .filter((order) => !args.status || order.status === args.status)
        .filter((order) => !args.vendorId || order.vendorId === args.vendorId)
        .slice(0, args.limit ?? 50);
}
export async function getOrder(id) {
    const order = (await readOrderStore()).orders.find((item) => item.id === id);
    if (!order) {
        throw new Error(`order '${id}' not found`);
    }
    return order;
}
export async function updateOrder(id, patch, event) {
    const store = await readOrderStore();
    const index = store.orders.findIndex((order) => order.id === id);
    if (index < 0) {
        throw new Error(`order '${id}' not found`);
    }
    const now = new Date().toISOString();
    const order = store.orders[index];
    const next = {
        ...order,
        ...patch,
        updatedAt: now,
        events: [{ at: now, ...event }, ...order.events],
    };
    store.orders[index] = next;
    await writeOrderStore(store);
    return next;
}
