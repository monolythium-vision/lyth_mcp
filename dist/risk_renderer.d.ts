export interface RiskRenderInput {
    title?: string;
    operation?: string;
    amount?: string;
    asset?: string;
    counterparty?: string;
    merchantRisk?: unknown;
    assetPolicy?: unknown;
    bridgeQuote?: unknown;
    commerceSafety?: unknown;
    preflight?: unknown;
    receiptPath?: string;
    retryPath?: string;
}
export interface RiskRenderOutput {
    ok: boolean;
    level: "low" | "medium" | "high" | "blocked";
    markdown: string;
    violations: string[];
    warnings: string[];
    assumptions: string[];
    retryPath?: string;
    receiptPath?: string;
}
export declare function renderRisk(input: RiskRenderInput): RiskRenderOutput;
