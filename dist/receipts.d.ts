export type ReceiptStatus = "drafted" | "signed" | "submitted" | "confirmed" | "failed";
export interface OperationReceipt {
    id: string;
    kind: string;
    status: ReceiptStatus;
    network: string;
    chainId: number;
    title: string;
    summary: string;
    createdAt: string;
    updatedAt: string;
    walletName?: string;
    from?: string;
    to?: string;
    amount?: string;
    asset?: string;
    outboxId?: string;
    txHash?: string;
    payloadHash?: string;
    endpoint?: string;
    result?: unknown;
    error?: string;
}
export interface ReceiptStore {
    schemaVersion: 1;
    receipts: OperationReceipt[];
}
export declare function receiptPath(): string;
export declare function readReceipts(path?: string): Promise<ReceiptStore>;
export declare function writeReceipts(store: ReceiptStore, path?: string): Promise<void>;
export declare function receiptInfo(path?: string): Promise<{
    path: string;
    receiptCount: number;
    fileMode: string | null;
}>;
export declare function addReceipt(args: Omit<OperationReceipt, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
}): Promise<OperationReceipt>;
export declare function listReceipts(args?: {
    status?: ReceiptStatus;
    kind?: string;
    walletName?: string;
    limit?: number;
}): Promise<OperationReceipt[]>;
export declare function getReceipt(id: string): Promise<OperationReceipt>;
