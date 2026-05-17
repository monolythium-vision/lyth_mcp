export interface CanonicalRunbook {
    id: string;
    name: string;
    version: string;
    file: string;
    schemaVersion: number;
    status?: string;
    purpose?: string;
    contentHash: string;
    hashAlgorithm: "sha256";
    bytes: number;
    updatedAt?: string;
    content: unknown;
}
export interface RunbookSummary {
    id: string;
    name: string;
    version: string;
    file: string;
    schemaVersion: number;
    status?: string;
    purpose?: string;
    contentHash: string;
    hashAlgorithm: "sha256";
    bytes: number;
    updatedAt?: string;
}
export declare function listCanonicalRunbooks(dir: string): Promise<RunbookSummary[]>;
export declare function getCanonicalRunbook(dir: string, idOrName: string): Promise<CanonicalRunbook>;
export declare function loadCanonicalRunbook(path: string): Promise<CanonicalRunbook>;
export declare function canonicalize(value: unknown): string;
export declare function diffRunbookContent(left: unknown, right: unknown): Array<{
    field: string;
    left: unknown;
    right: unknown;
}>;
