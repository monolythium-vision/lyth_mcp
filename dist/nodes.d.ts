export type NodeRole = "validator" | "rpc" | "archive" | "prover" | "oracle" | "indexer";
export type NodeStatus = "active" | "draft" | "degraded" | "paused" | "retired";
export type NodeHostingClass = "community_baremetal" | "cloud_dedicated" | "cloud_shared" | "cloud_gpu" | "planned_mixed";
export type AttestationStatus = "verified" | "draft" | "missing" | "expired" | "mismatch";
export interface NodeRegistry {
    schemaVersion?: number;
    network?: string;
    issuer?: string;
    updatedAt?: string;
    disclaimer?: string;
    nodes: NodeRecord[];
    [key: string]: unknown;
}
export interface NodeRecord {
    id: string;
    displayName?: string;
    clusterId: string;
    operatorId?: string;
    role: NodeRole;
    status: NodeStatus;
    region?: string;
    jurisdiction?: string;
    hosting?: {
        class?: NodeHostingClass;
        provider?: string;
        asn?: number;
        country?: string;
        datacenter?: string;
    };
    hardware?: {
        cpuClass?: string;
        ramGb?: number;
        storageTb?: number;
        gpu?: boolean;
        gpuClass?: string;
        tpm?: boolean;
        secureBoot?: boolean;
    };
    attestation?: {
        status?: AttestationStatus;
        method?: string;
        measuredAt?: string;
        quoteHash?: string;
        pcrs?: Record<string, string>;
        expectedPcrs?: Record<string, string>;
        notes?: string;
    };
    [key: string]: unknown;
}
export interface LoadedNodeRegistry {
    source: string;
    registry: NodeRegistry;
    contentHash: string;
    bytes: number;
    updatedAt?: string;
}
export declare function loadNodeRegistry(path: string): Promise<LoadedNodeRegistry>;
export declare function nodeRegistrySummary(loaded: LoadedNodeRegistry): {
    source: string;
    schemaVersion: number | undefined;
    network: string | undefined;
    issuer: string | undefined;
    disclaimer: string | undefined;
    contentHash: string;
    bytes: number;
    updatedAt: string | undefined;
    nodeCount: number;
    roles: NodeRole[];
    statuses: NodeStatus[];
    hostingClasses: (NodeHostingClass | undefined)[];
    attestationStatuses: AttestationStatus[];
};
export declare function listNodes(registry: NodeRegistry, args?: {
    query?: string;
    clusterId?: string;
    operatorId?: string;
    role?: NodeRole;
    status?: NodeStatus;
    region?: string;
    hostingClass?: NodeHostingClass;
    attestationStatus?: AttestationStatus;
    gpuRequired?: boolean;
    tpmRequired?: boolean;
    limit?: number;
}): NodeRecord[];
export declare function getNode(registry: NodeRegistry, id: string): NodeRecord;
export declare function nodeAttestation(node: NodeRecord): {
    ok: boolean;
    nodeId: string;
    clusterId: string;
    operatorId: string | undefined;
    status: AttestationStatus;
    method: string | undefined;
    measuredAt: string | undefined;
    quoteHash: string | undefined;
    pcrs: Record<string, string>;
    expectedPcrs: Record<string, string>;
    mismatches: {
        pcr: string;
        expected: string;
        actual: string;
        meaning: string;
    }[];
    violations: string[];
    warnings: string[];
    assumptions: string[];
};
export declare function explainPcr(node: NodeRecord, pcr?: string): {
    nodeId: string;
    pcr: string;
    entries: {
        pcr: string;
        actual: string;
        expected: string;
        matchesExpected: string | boolean;
        meaning: string;
    }[];
    explanation: string;
};
export declare function nodeDiversityScore(registry: NodeRegistry, args?: {
    clusterId?: string;
    operatorId?: string;
    region?: string;
    role?: NodeRole;
}): {
    ok: boolean;
    scope: {
        clusterId?: string;
        operatorId?: string;
        region?: string;
        role?: NodeRole;
    };
    score: number;
    level: string;
    counts: {
        nodes: number;
        asns: number;
        providers: number;
        countries: number;
        hostingClasses: number;
        operators: number;
        clusters: number;
    };
    asns: string[];
    providers: string[];
    countries: string[];
    hostingClasses: string[];
    operators: string[];
    clusters: string[];
    warnings: string[];
    assumptions: string[];
};
export declare function nodeHostingClass(node: NodeRecord): {
    nodeId: string;
    hosting: {
        class?: NodeHostingClass;
        provider?: string;
        asn?: number;
        country?: string;
        datacenter?: string;
    } | undefined;
    risk: string;
    explanation: string;
    warnings: string[];
};
