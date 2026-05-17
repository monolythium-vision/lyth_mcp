export interface VendorRegistrySignature {
    algorithm?: string;
    publicKeyPem?: string;
    signatureBase64?: string;
}
export interface VendorRegistry {
    schemaVersion?: number;
    network?: string;
    issuer?: string;
    expiresAt?: string;
    disclaimer?: string;
    signature?: VendorRegistrySignature;
    signatures?: VendorRegistrySignature[];
    vendors: VendorRecord[];
    [key: string]: unknown;
}
export interface VendorRecord {
    id: string;
    displayName?: string;
    category?: string;
    address?: string;
    acceptedAssets?: string[];
    maxOrderAmount?: string;
    serviceTags?: string[];
    fulfillment?: {
        type?: string;
        etaMinutes?: number;
        requiredFields?: string[];
        [key: string]: unknown;
    };
    catalog?: VendorCatalogItem[];
    [key: string]: unknown;
}
export interface VendorCatalogItem {
    id: string;
    name?: string;
    description?: string;
    price?: string;
    asset?: string;
    [key: string]: unknown;
}
export interface LoadedVendorRegistry {
    source: string;
    registry: VendorRegistry;
    contentHash: string;
    payloadHash: string;
    bytes: number;
    updatedAt?: string;
    signatureStatus: {
        status: "unsigned" | "verified" | "invalid" | "present_unverified";
        reason: string;
        expired: boolean;
        expiresAt?: string;
    };
}
export interface VendorQuote {
    vendorId: string;
    vendorDisplayName?: string;
    vendorAddress?: string;
    itemId?: string;
    itemName?: string;
    quantity: number;
    amount: string;
    asset: string;
    fulfillmentType?: string;
    requiredFulfillmentFields: string[];
    missingFulfillmentFields: string[];
    warnings: string[];
    registryHash: string;
}
export declare function loadVendorRegistry(path: string): Promise<LoadedVendorRegistry>;
export declare function vendorRegistrySummary(loaded: LoadedVendorRegistry): {
    source: string;
    schemaVersion: number | undefined;
    network: string | undefined;
    issuer: string | undefined;
    expiresAt: string | undefined;
    disclaimer: string | undefined;
    contentHash: string;
    payloadHash: string;
    bytes: number;
    updatedAt: string | undefined;
    signatureStatus: {
        status: "unsigned" | "verified" | "invalid" | "present_unverified";
        reason: string;
        expired: boolean;
        expiresAt?: string;
    };
    vendorCount: number;
    categories: (string | undefined)[];
};
export declare function searchVendors(registry: VendorRegistry, args?: {
    query?: string;
    category?: string;
    limit?: number;
}): VendorRecord[];
export declare function getVendor(registry: VendorRegistry, vendorId: string): VendorRecord;
export declare function quoteVendorOrder(args: {
    registryHash: string;
    vendor: VendorRecord;
    itemId?: string;
    quantity?: number;
    asset?: string;
    fulfillmentFields?: Record<string, unknown>;
}): VendorQuote;
