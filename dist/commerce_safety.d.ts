export interface CommerceSafetyInput {
    query?: string;
    category?: string;
    service?: string;
    description?: string;
    vendorId?: string;
}
export interface CommerceSafetyEvaluation {
    ok: boolean;
    level: "allow" | "warn" | "block";
    violations: string[];
    warnings: string[];
    policyBasis: string[];
    clientAction: "allow" | "hide_or_refuse" | "require_human_review";
    notes: string[];
}
export declare function evaluateCommerceSafety(input: CommerceSafetyInput): CommerceSafetyEvaluation;
export declare function commerceSafetySummary(input: CommerceSafetyInput): {
    summary: string;
    ok: boolean;
    level: "allow" | "warn" | "block";
    violations: string[];
    warnings: string[];
    policyBasis: string[];
    clientAction: "allow" | "hide_or_refuse" | "require_human_review";
    notes: string[];
    input: CommerceSafetyInput;
};
