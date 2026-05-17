export type DelegationPhase = "bootstrap" | "growth" | "mature";
export interface DelegationCapInput {
    phase?: DelegationPhase;
    clusterId?: string;
    totalDelegatedStake?: string;
    currentClusterStake?: string;
    intendedAdditionalStake?: string;
    selectedClusterCount?: number;
    overCapEpochs?: number;
}
export interface DelegationPhaseConfig {
    phase: DelegationPhase;
    perClusterCapPercent: number;
    minimumClusters: number;
    overCapGraceEpochs: number;
    maxRewardTaperPercent: number;
    explanation: string;
}
export declare function delegationPhaseConfig(phase?: DelegationPhase): DelegationPhaseConfig;
export declare function explainDelegationCaps(input?: DelegationCapInput): {
    ok: boolean;
    clusterId: string | undefined;
    phase: DelegationPhaseConfig;
    totals: {
        totalDelegatedStake: string | undefined;
        currentClusterStake: string | undefined;
        intendedAdditionalStake: string | undefined;
        projectedClusterStake: string | undefined;
        capAmount: string | undefined;
        projectedClusterSharePercent: number | undefined;
        overCapAmount: string | undefined;
    };
    diversification: {
        selectedClusterCount: number;
        minimumClusters: number;
        ok: boolean;
    };
    taper: {
        overCap: boolean;
        overCapEpochs: number;
        graceEpochs: number;
        graceRemaining: number;
        rewardTaperPercent: number;
        estimatedRewardMultiplier: number;
    };
    warnings: string[];
    explanation: string[];
    assumptions: string[];
};
