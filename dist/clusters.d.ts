export type ClusterStatus = "active" | "draft" | "degraded" | "sunsetting" | "retired";
export type ClusterServiceType = "rpc" | "archive" | "prover" | "oracle" | "indexer" | "validator";
export interface ClusterRegistry {
    schemaVersion?: number;
    network?: string;
    issuer?: string;
    updatedAt?: string;
    disclaimer?: string;
    clusters: ClusterRecord[];
    operators?: OperatorRecord[];
    [key: string]: unknown;
}
export interface ClusterServiceTier {
    type: ClusterServiceType;
    status: "active" | "draft" | "degraded" | "paused";
    pricePerMonth?: string;
    pricePerProof?: string;
    asset?: string;
    uptime30d?: number;
    gpuClass?: string;
    capacity?: string;
    proofLatencyMsP50?: number;
    [key: string]: unknown;
}
export interface ClusterRecord {
    id: string;
    displayName?: string;
    region?: string;
    jurisdiction?: string;
    status: ClusterStatus;
    foundationControlled?: boolean;
    quorum?: string;
    operatorSeats?: {
        total?: number;
        open?: number;
    };
    serviceTiers?: ClusterServiceTier[];
    reputation?: {
        score?: number;
        uptime30d?: number;
        slashingIncidents?: number;
        missedRounds30d?: number;
        responseTimeMsP50?: number;
        communityTrust?: number;
    };
    diversity?: {
        asnCount?: number;
        hostingClass?: string;
        clientDiversity?: number;
        geographicDiversity?: number;
        decentralizationScore?: number;
    };
    hardware?: {
        cpuClass?: string;
        ramGb?: number;
        storageTb?: number;
        gpu?: boolean;
        gpuClass?: string;
    };
    operators?: string[];
    sunset?: {
        planned?: boolean;
        at?: string;
        reason?: string;
        replacementClusterId?: string;
    };
    notes?: string[];
    [key: string]: unknown;
}
export interface OperatorRecord {
    id: string;
    displayName?: string;
    region?: string;
    foundationControlled?: boolean;
    clusterIds?: string[];
    openSeatInterest?: boolean;
    reputation?: {
        score?: number;
        uptime30d?: number;
        slashingIncidents?: number;
    };
    attestation?: {
        status?: "verified" | "draft" | "missing" | "expired";
        method?: string;
        notes?: string;
    };
    [key: string]: unknown;
}
export interface LoadedClusterRegistry {
    source: string;
    registry: ClusterRegistry;
    contentHash: string;
    bytes: number;
    updatedAt?: string;
}
export declare function loadClusterRegistry(path: string): Promise<LoadedClusterRegistry>;
export declare function clusterRegistrySummary(loaded: LoadedClusterRegistry): {
    source: string;
    schemaVersion: number | undefined;
    network: string | undefined;
    issuer: string | undefined;
    disclaimer: string | undefined;
    contentHash: string;
    bytes: number;
    updatedAt: string | undefined;
    clusterCount: number;
    operatorCount: number;
    foundationControlledCount: number;
    regions: (string | undefined)[];
    statuses: ClusterStatus[];
    services: ClusterServiceType[];
};
export declare function listClusters(registry: ClusterRegistry, args?: {
    query?: string;
    region?: string;
    jurisdiction?: string;
    status?: ClusterStatus;
    serviceType?: ClusterServiceType;
    foundationControlled?: boolean;
    gpuRequired?: boolean;
    minOpenSeats?: number;
    limit?: number;
}): ClusterRecord[];
export declare function getCluster(registry: ClusterRegistry, id: string): ClusterRecord;
export declare function clusterReputation(cluster: ClusterRecord): {
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
    serviceTiers: ClusterServiceTier[] | undefined;
    assumptions: string[];
};
export declare function clusterFoundationFlag(cluster: ClusterRecord): {
    clusterId: string;
    foundationControlled: boolean;
    explanation: string;
    stakingGuidance: string;
};
export declare function clusterSunsetStatus(cluster: ClusterRecord): {
    clusterId: string;
    status: ClusterStatus;
    planned: boolean;
    sunset: {
        planned?: boolean;
        at?: string;
        reason?: string;
        replacementClusterId?: string;
    } | undefined;
    warning: string | undefined;
};
export declare function listOperators(registry: ClusterRegistry, args?: {
    query?: string;
    region?: string;
    clusterId?: string;
    foundationControlled?: boolean;
    openSeatInterest?: boolean;
    limit?: number;
}): OperatorRecord[];
export declare function getOperator(registry: ClusterRegistry, id: string): OperatorRecord;
export declare function operatorStatus(registry: ClusterRegistry, operator: OperatorRecord): {
    operator: OperatorRecord;
    clusters: ClusterRecord[];
    openSeats: number;
    attestation: {
        status?: "verified" | "draft" | "missing" | "expired";
        method?: string;
        notes?: string;
    } | undefined;
    warnings: string[];
    assumptions: string[];
};
export declare function monarchOperatorAssistant(registry: ClusterRegistry, args?: {
    clusterId?: string;
    operatorId?: string;
    region?: string;
    serviceType?: ClusterServiceType;
    includeDraft?: boolean;
    limit?: number;
}): {
    scope: {
        clusterId: string | undefined;
        operatorId: string | undefined;
        region: string | undefined;
        serviceType: ClusterServiceType | undefined;
        includeDraft: boolean;
    };
    operator: {
        operator: OperatorRecord;
        clusters: ClusterRecord[];
        openSeats: number;
        attestation: {
            status?: "verified" | "draft" | "missing" | "expired";
            method?: string;
            notes?: string;
        } | undefined;
        warnings: string[];
        assumptions: string[];
    } | undefined;
    clusters: {
        clusterId: string;
        displayName: string | undefined;
        status: ClusterStatus;
        health: {
            level: string;
            score: number;
            uptime30d: number | undefined;
            missedRounds30d: number | undefined;
            slashingIncidents: number;
            warnings: string[];
        };
        quorum: {
            configured: string;
            explanation: string;
            openSeats: number;
            totalSeats: number | undefined;
        };
        updateStatus: {
            status: ClusterStatus;
            safeForNewOps: boolean;
            note: string;
            todo: string;
        };
        resourcePressure: {
            level: string;
            seatPressurePercent: number;
            openSeats: number;
            activeServiceCount: number;
            degradedServiceCount: number;
            gpuPressure: string;
            hardware: {
                cpuClass?: string;
                ramGb?: number;
                storageTb?: number;
                gpu?: boolean;
                gpuClass?: string;
            } | undefined;
            warnings: string[];
        };
        serviceRoi: {
            type: ClusterServiceType;
            status: "active" | "draft" | "degraded" | "paused";
            pricePerMonth: string | undefined;
            pricePerProof: string | undefined;
            asset: string | undefined;
            uptime30d: number | undefined;
            gpuClass: string | undefined;
            capacity: string | undefined;
            proofLatencyMsP50: number | undefined;
            roiScore: number;
            interpretation: string;
            todo: string;
        }[];
        operatorSeats: {
            total?: number;
            open?: number;
        } | undefined;
        serviceTiers: ClusterServiceTier[] | undefined;
        foundation: {
            clusterId: string;
            foundationControlled: boolean;
            explanation: string;
            stakingGuidance: string;
        };
        sunset: {
            clusterId: string;
            status: ClusterStatus;
            planned: boolean;
            sunset: {
                planned?: boolean;
                at?: string;
                reason?: string;
                replacementClusterId?: string;
            } | undefined;
            warning: string | undefined;
        };
        nodeOpsOnly: boolean;
    }[];
    recommendations: string[];
    guardrails: string[];
};
export declare function monarchClusterReport(cluster: ClusterRecord): {
    clusterId: string;
    displayName: string | undefined;
    status: ClusterStatus;
    health: {
        level: string;
        score: number;
        uptime30d: number | undefined;
        missedRounds30d: number | undefined;
        slashingIncidents: number;
        warnings: string[];
    };
    quorum: {
        configured: string;
        explanation: string;
        openSeats: number;
        totalSeats: number | undefined;
    };
    updateStatus: {
        status: ClusterStatus;
        safeForNewOps: boolean;
        note: string;
        todo: string;
    };
    resourcePressure: {
        level: string;
        seatPressurePercent: number;
        openSeats: number;
        activeServiceCount: number;
        degradedServiceCount: number;
        gpuPressure: string;
        hardware: {
            cpuClass?: string;
            ramGb?: number;
            storageTb?: number;
            gpu?: boolean;
            gpuClass?: string;
        } | undefined;
        warnings: string[];
    };
    serviceRoi: {
        type: ClusterServiceType;
        status: "active" | "draft" | "degraded" | "paused";
        pricePerMonth: string | undefined;
        pricePerProof: string | undefined;
        asset: string | undefined;
        uptime30d: number | undefined;
        gpuClass: string | undefined;
        capacity: string | undefined;
        proofLatencyMsP50: number | undefined;
        roiScore: number;
        interpretation: string;
        todo: string;
    }[];
    operatorSeats: {
        total?: number;
        open?: number;
    } | undefined;
    serviceTiers: ClusterServiceTier[] | undefined;
    foundation: {
        clusterId: string;
        foundationControlled: boolean;
        explanation: string;
        stakingGuidance: string;
    };
    sunset: {
        clusterId: string;
        status: ClusterStatus;
        planned: boolean;
        sunset: {
            planned?: boolean;
            at?: string;
            reason?: string;
            replacementClusterId?: string;
        } | undefined;
        warning: string | undefined;
    };
    nodeOpsOnly: boolean;
};
export declare function searchServices(registry: ClusterRegistry, args: {
    serviceType: ClusterServiceType;
    region?: string;
    activeOnly?: boolean;
    gpuClass?: string;
    maxLatencyMs?: number;
    limit?: number;
}): {
    clusterId: string;
    clusterDisplayName: string | undefined;
    region: string | undefined;
    jurisdiction: string | undefined;
    foundationControlled: boolean;
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
        serviceTiers: ClusterServiceTier[] | undefined;
        assumptions: string[];
    };
    service: ClusterServiceTier;
}[];
