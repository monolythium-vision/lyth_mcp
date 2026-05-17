import type { TxOutboxEntry } from "./outbox.js";
import type { OperationReceipt } from "./receipts.js";
import type { WalletSummary } from "./wallet.js";
export interface AccountSafetyProfileArgs {
    wallets: WalletSummary[];
    outboxEntries: TxOutboxEntry[];
    receipts: OperationReceipt[];
    walletName?: string;
    now?: Date;
}
export interface HotWalletPolicySimulationArgs {
    wallet: WalletSummary;
    amount: string;
    asset?: string;
    counterparty?: string;
    category?: string;
    now?: Date;
}
export interface ThresholdExplanationArgs {
    amount?: string;
    asset?: string;
    lowValueCap?: string;
    passkeyCap?: string;
    hardwareCap?: string;
    walletHasLowValuePolicy?: boolean;
    passkeyAvailable?: boolean;
    hardwareWalletAvailable?: boolean;
}
type RiskLevel = "low" | "medium" | "high" | "blocked";
export declare function accountSafetyProfiles(args: AccountSafetyProfileArgs): {
    checkedAt: string;
    walletCount: number;
    highestRisk: RiskLevel;
    profiles: {
        wallet: {
            name: string;
            address: string;
            keyProtection: "passphrase" | "local_machine_key";
            createdAt: string;
        };
        risk: {
            level: RiskLevel;
            score: number;
            reasons: string[];
        };
        strengths: string[];
        warnings: string[];
        policy: {
            lowValue: (Omit<import("./wallet.js").LowValuePolicy, "encryptedMnemonic"> & {
                accounting?: import("./wallet.js").LowValueAccountingSummary;
            }) | null;
            agent: import("./wallet.js").AgentWalletMetadata | null;
        };
        outbox: {
            signed: number;
            submitted: number;
            latest: {
                id: string;
                status: import("./outbox.js").OutboxStatus;
                amount: string | undefined;
                asset: string | undefined;
                to: string | undefined;
                expiresAt: string | undefined;
            }[];
        };
        recovery: {
            pauseTool: string;
            drainTool: string;
            deleteTool: string;
            notes: string[];
        };
        missingProductionSignals: string[];
    }[];
    productionNotes: string[];
};
export declare function simulateHotWalletPolicy(args: HotWalletPolicySimulationArgs): {
    ok: boolean;
    checkedAt: string;
    wallet: {
        name: string;
        address: string;
        keyProtection: "passphrase" | "local_machine_key";
        agent: import("./wallet.js").AgentWalletMetadata | undefined;
        lowValue: (Omit<import("./wallet.js").LowValuePolicy, "encryptedMnemonic"> & {
            accounting?: import("./wallet.js").LowValueAccountingSummary;
        }) | undefined;
    };
    request: {
        amount: string;
        asset: string;
        counterparty: string | undefined;
        category: string | undefined;
    };
    decision: string;
    matchedClauses: string[];
    violations: string[];
    warnings: string[];
    fallback: "passphrase" | "wallet_handoff" | "deny";
};
export declare function explainWalletThresholds(args?: ThresholdExplanationArgs): {
    asset: string;
    amount: string | undefined;
    selectedTier: string | null;
    tiers: {
        tier: string;
        available: boolean;
        recommendedFor: string;
        limit: string;
        approval: string;
    }[];
    rules: string[];
};
export {};
