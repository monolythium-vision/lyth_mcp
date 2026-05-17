export type InvoiceStatus = "open" | "paid" | "cancelled" | "expired";
export interface InvoiceRecord {
    id: string;
    type: "invoice" | "funding_request";
    status: InvoiceStatus;
    network: string;
    chainId: number;
    createdAt: string;
    updatedAt: string;
    expiresAt?: string;
    recipient: string;
    amount: string;
    asset: string;
    purpose: string;
    payer?: string;
    memo?: string;
    txHash?: string;
    events: Array<{
        at: string;
        type: string;
        data?: unknown;
    }>;
}
export interface InvoiceStore {
    schemaVersion: 1;
    invoices: InvoiceRecord[];
}
export declare function invoiceStorePath(): string;
export declare function readInvoiceStore(path?: string): Promise<InvoiceStore>;
export declare function writeInvoiceStore(store: InvoiceStore, path?: string): Promise<void>;
export declare function invoiceStoreInfo(path?: string): Promise<{
    path: string;
    invoiceCount: number;
    fileMode: string | null;
}>;
export declare function createInvoice(args: Omit<InvoiceRecord, "id" | "status" | "createdAt" | "updatedAt" | "events">): Promise<InvoiceRecord>;
export declare function getInvoice(id: string): Promise<InvoiceRecord>;
export declare function listInvoices(args?: {
    status?: InvoiceStatus;
    type?: "invoice" | "funding_request";
    limit?: number;
}): Promise<InvoiceRecord[]>;
export declare function updateInvoice(id: string, patch: Partial<Omit<InvoiceRecord, "id" | "createdAt" | "events">>, eventType: string, data?: unknown): Promise<InvoiceRecord>;
