import { type ClusterRecord, type ClusterRegistry } from "./clusters.js";
export type DelegationPhase = "bootstrap" | "growth" | "mature";
export type DelegationMode = "max_yield" | "max_diversity" | "max_decentralization" | "custom";
export interface DelegationPosition {
    clusterId: string;
    amount: string;
}
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
export declare function stakeStatus(registry: ClusterRegistry, input?: {
    positions?: DelegationPosition[];
    phase?: DelegationPhase;
}): {
    ok: boolean;
    phase: DelegationPhaseConfig;
    totalDelegatedStake: string;
    selectedClusterCount: number;
    positions: {
        position: DelegationPosition;
        cluster: ClusterRecord | null;
        reputation: {
            clusterId: string;
            displayName: string | undefined;
            score: number;
            level: string;
            labels: string[];
            warnings: string[];
            reputation: {
                score?: number;
                uptime30d?: number;
                slashingIncidents?: number;
                missedRounds30d?: number;
                responseTimeMsP50?: number;
                communityTrust?: number;
            } | undefined;
            diversity: {
                asnCount?: number;
                hostingClass?: string;
                clientDiversity?: number;
                geographicDiversity?: number;
                decentralizationScore?: number;
            } | undefined;
            serviceTiers: import("./clusters.js").ClusterServiceTier[] | undefined;
            assumptions: string[];
        } | undefined;
        foundation: {
            clusterId: string;
            foundationControlled: boolean;
            explanation: string;
            stakingGuidance: string;
        } | undefined;
        cap: {
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
    }[];
    warnings: string[];
    assumptions: string[];
};
export declare function delegateDraft(registry: ClusterRegistry, input: {
    clusterId: string;
    amount: string;
    mode?: DelegationMode;
    phase?: DelegationPhase;
    positions?: DelegationPosition[];
}): {
    draftId: string;
    operation: string;
    mode: DelegationMode;
    cluster: ClusterRecord;
    amount: string;
    cap: {
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
    reputation: {
        clusterId: string;
        displayName: string | undefined;
        score: number;
        level: string;
        labels: string[];
        warnings: string[];
        reputation: {
            score?: number;
            uptime30d?: number;
            slashingIncidents?: number;
            missedRounds30d?: number;
            responseTimeMsP50?: number;
            communityTrust?: number;
        } | undefined;
        diversity: {
            asnCount?: number;
            hostingClass?: string;
            clientDiversity?: number;
            geographicDiversity?: number;
            decentralizationScore?: number;
        } | undefined;
        serviceTiers: import("./clusters.js").ClusterServiceTier[] | undefined;
        assumptions: string[];
    };
    foundation: {
        clusterId: string;
        foundationControlled: boolean;
        explanation: string;
        stakingGuidance: string;
    };
    warnings: string[];
    unsigned: boolean;
    todo: string[];
};
export declare function undelegateDraft(registry: ClusterRegistry, input: {
    clusterId: string;
    amount: string;
    positions?: DelegationPosition[];
    reason?: string;
}): {
    draftId: string;
    operation: string;
    cluster: ClusterRecord;
    amount: string;
    currentPosition: string;
    reason: string | undefined;
    warnings: string[];
    unsigned: boolean;
    todo: string[];
};
export declare function rebalanceDraft(registry: ClusterRegistry, input: {
    mode?: DelegationMode;
    phase?: DelegationPhase;
    positions?: DelegationPosition[];
    targetClusterCount?: number;
}): {
    draftId: string;
    operation: string;
    mode: DelegationMode;
    phase: DelegationPhaseConfig;
    totalDelegatedStake: string;
    targetClusterCount: number;
    operations: {
        clusterId: string;
        displayName: string | undefined;
        currentAmount: string;
        targetAmount: string;
        delta: string;
        action: string;
        reputation: {
            clusterId: string;
            displayName: string | undefined;
            score: number;
            level: string;
            labels: string[];
            warnings: string[];
            reputation: {
                score?: number;
                uptime30d?: number;
                slashingIncidents?: number;
                missedRounds30d?: number;
                responseTimeMsP50?: number;
                communityTrust?: number;
            } | undefined;
            diversity: {
                asnCount?: number;
                hostingClass?: string;
                clientDiversity?: number;
                geographicDiversity?: number;
                decentralizationScore?: number;
            } | undefined;
            serviceTiers: import("./clusters.js").ClusterServiceTier[] | undefined;
            assumptions: string[];
        };
        foundation: {
            clusterId: string;
            foundationControlled: boolean;
            explanation: string;
            stakingGuidance: string;
        };
    }[];
    warnings: string[];
    todo: string[];
};
export declare function autovoteSimulate(registry: ClusterRegistry, input: {
    mode?: DelegationMode;
    phase?: DelegationPhase;
    positions?: DelegationPosition[];
    candidateLimit?: number;
}): {
    simulationId: string;
    mode: DelegationMode;
    phase: DelegationPhaseConfig;
    currentStatus: {
        ok: boolean;
        phase: DelegationPhaseConfig;
        totalDelegatedStake: string;
        selectedClusterCount: number;
        positions: {
            position: DelegationPosition;
            cluster: ClusterRecord | null;
            reputation: {
                clusterId: string;
                displayName: string | undefined;
                score: number;
                level: string;
                labels: string[];
                warnings: string[];
                reputation: {
                    score?: number;
                    uptime30d?: number;
                    slashingIncidents?: number;
                    missedRounds30d?: number;
                    responseTimeMsP50?: number;
                    communityTrust?: number;
                } | undefined;
                diversity: {
                    asnCount?: number;
                    hostingClass?: string;
                    clientDiversity?: number;
                    geographicDiversity?: number;
                    decentralizationScore?: number;
                } | undefined;
                serviceTiers: import("./clusters.js").ClusterServiceTier[] | undefined;
                assumptions: string[];
            } | undefined;
            foundation: {
                clusterId: string;
                foundationControlled: boolean;
                explanation: string;
                stakingGuidance: string;
            } | undefined;
            cap: {
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
        }[];
        warnings: string[];
        assumptions: string[];
    };
    rankedCandidates: {
        rank: number;
        clusterId: string;
        displayName: string | undefined;
        score: number;
        reputation: {
            clusterId: string;
            displayName: string | undefined;
            score: number;
            level: string;
            labels: string[];
            warnings: string[];
            reputation: {
                score?: number;
                uptime30d?: number;
                slashingIncidents?: number;
                missedRounds30d?: number;
                responseTimeMsP50?: number;
                communityTrust?: number;
            } | undefined;
            diversity: {
                asnCount?: number;
                hostingClass?: string;
                clientDiversity?: number;
                geographicDiversity?: number;
                decentralizationScore?: number;
            } | undefined;
            serviceTiers: import("./clusters.js").ClusterServiceTier[] | undefined;
            assumptions: string[];
        };
        foundation: {
            clusterId: string;
            foundationControlled: boolean;
            explanation: string;
            stakingGuidance: string;
        };
        rationale: string;
    }[];
    warnings: string[];
};
