import type { VendorQuote, VendorRecord } from "./vendors.js";
export interface MerchantPolicy {
    vendorId: string;
    enabled: boolean;
    allowlisted?: boolean;
    denylisted?: boolean;
    maxOrderAmount?: string;
    allowedAssets?: string[];
    allowedCategories?: string[];
    jurisdictionNotes?: string;
    refundPolicy?: string;
    fulfillmentSla?: string;
    disputeProcess?: string;
    riskNotes?: string;
    createdAt: string;
    updatedAt: string;
}
export interface MerchantPolicyStore {
    schemaVersion: 1;
    policies: MerchantPolicy[];
}
export interface MerchantPolicyPatch {
    vendorId: string;
    enabled?: boolean;
    allowlisted?: boolean;
    denylisted?: boolean;
    maxOrderAmount?: string;
    allowedAssets?: string[];
    allowedCategories?: string[];
    jurisdictionNotes?: string;
    refundPolicy?: string;
    fulfillmentSla?: string;
    disputeProcess?: string;
    riskNotes?: string;
}
export interface MerchantPolicyEvaluation {
    ok: boolean;
    riskLevel: "unknown" | "low" | "medium" | "high" | "blocked";
    vendorId: string;
    vendorDisplayName?: string;
    policyConfigured: boolean;
    policy?: MerchantPolicy;
    violations: string[];
    warnings: string[];
    notes: string[];
}
export declare function merchantPolicyStorePath(): string;
export declare function readMerchantPolicyStore(path?: string): Promise<MerchantPolicyStore>;
export declare function writeMerchantPolicyStore(store: MerchantPolicyStore, path?: string): Promise<void>;
export declare function merchantPolicyStoreInfo(path?: string): Promise<{
    path: string;
    policyCount: number;
    fileMode: string | null;
}>;
export declare function upsertMerchantPolicy(patch: MerchantPolicyPatch): Promise<MerchantPolicy>;
export declare function getMerchantPolicy(vendorId: string): Promise<MerchantPolicy | null>;
export declare function listMerchantPolicies(args?: {
    vendorId?: string;
    onlyBlocked?: boolean;
    limit?: number;
}): Promise<MerchantPolicy[]>;
export declare function removeMerchantPolicy(vendorId: string): Promise<{
    removed: boolean;
    vendorId: string;
}>;
export declare function evaluateMerchantPolicy(args: {
    vendor: VendorRecord;
    quote?: VendorQuote;
    policy?: MerchantPolicy | null;
    amount?: string;
    asset?: string;
}): MerchantPolicyEvaluation;
