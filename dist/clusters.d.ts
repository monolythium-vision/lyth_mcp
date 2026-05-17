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
