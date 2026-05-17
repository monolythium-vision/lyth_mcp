import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
const STORE_VERSION = 1;
export function bookingStorePath() {
    return process.env.LYTH_MCP_BOOKING_STORE || join(homedir(), ".lyth_mcp", "bookings.json");
}
export async function readBookingStore(path = bookingStorePath()) {
    try {
        const raw = await readFile(path, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.schemaVersion !== STORE_VERSION || !Array.isArray(parsed.bookings)) {
            throw new Error(`unsupported booking store shape at ${path}`);
        }
        return parsed;
    }
    catch (err) {
        if (err.code === "ENOENT") {
            return { schemaVersion: STORE_VERSION, bookings: [] };
        }
        throw err;
    }
}
export async function writeBookingStore(store, path = bookingStorePath()) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, path);
}
export async function bookingStoreInfo(path = bookingStorePath()) {
    const store = await readBookingStore(path);
    let mode = null;
    try {
        mode = `0${(await stat(path)).mode.toString(8).slice(-3)}`;
    }
    catch {
        mode = null;
    }
    return {
        path,
        bookingCount: store.bookings.length,
        fileMode: mode,
    };
}
export async function createBooking(args) {
    const now = new Date().toISOString();
    const booking = {
        ...args,
        id: `booking_${Date.now()}_${randomUUID().slice(0, 8)}`,
        status: "requested",
        createdAt: now,
        updatedAt: now,
        events: [{ at: now, type: "requested", data: args.quote }],
    };
    const store = await readBookingStore();
    store.bookings.unshift(booking);
    await writeBookingStore(store);
    return booking;
}
export async function getBooking(id) {
    const booking = (await readBookingStore()).bookings.find((item) => item.id === id);
    if (!booking) {
        throw new Error(`booking '${id}' not found`);
    }
    return booking;
}
export async function listBookings(args = {}) {
    return (await readBookingStore()).bookings
        .filter((booking) => !args.status || booking.status === args.status)
        .filter((booking) => !args.vendorId || booking.vendorId === args.vendorId)
        .slice(0, args.limit ?? 50);
}
export async function updateBooking(id, patch, event) {
    const store = await readBookingStore();
    const index = store.bookings.findIndex((booking) => booking.id === id);
    if (index < 0) {
        throw new Error(`booking '${id}' not found`);
    }
    const now = new Date().toISOString();
    const booking = store.bookings[index];
    const next = {
        ...booking,
        ...patch,
        updatedAt: now,
        events: [{ at: now, ...event }, ...booking.events],
    };
    store.bookings[index] = next;
    await writeBookingStore(store);
    return next;
}
