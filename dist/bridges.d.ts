export type BridgeRouteType = "ibc" | "zk_light_client" | "trusted" | "issuer_native" | "manual";
export type BridgeRouteStatus = "active" | "draft" | "degraded" | "paused";
export interface BridgeRegistry {
    schemaVersion?: number;
    network?: string;
    issuer?: string;
    updatedAt?: string;
    epochHours?: number;
    disclaimer?: string;
    routes: BridgeRoute[];
    [key: string]: unknown;
}
export interface BridgeRoute {
    id: string;
    displayName?: string;
    status: BridgeRouteStatus;
    routeType: BridgeRouteType;
    sourceChain: string;
    destinationChain: string;
    sourceAsset: string;
    destinationAsset: string;
    cooldown?: {
        epochs?: number;
        hours?: number;
        label?: string;
    };
    finality?: {
        threshold?: string;
        notes?: string;
    };
    fees?: {
        flat?: string;
        bps?: number;
        asset?: string;
    };
    limits?: {
        minAmount?: string;
        maxAmount?: string;
    };
    drainCap?: {
        perEpoch?: string;
        remaining?: string;
        asset?: string;
    };
    circuitBreaker?: {
        enabled?: boolean;
        paused?: boolean;
        reason?: string;
    };
    trustAssumptions?: string[];
    dependencies?: string[];
    audits?: string[];
    insurance?: string;
    upgradeAuthority?: string;
    liquidityVenues?: string[];
    notes?: string[];
    [key: string]: unknown;
}
export interface LoadedBridgeRegistry {
    source: string;
    registry: BridgeRegistry;
    contentHash: string;
    bytes: number;
    updatedAt?: string;
}
export interface BridgeQuote {
    executable: boolean;
    route: BridgeRoute;
    amount: string;
    asset: string;
    estimatedFee: string;
    estimatedReceiveAmount: string;
    cooldown: {
        epochs?: number;
        hours: number;
        label: string;
    };
    risk: BridgeRisk;
    violations: string[];
    warnings: string[];
}
export interface BridgeRisk {
    level: "low" | "medium" | "high" | "blocked";
    reasons: string[];
    trustModel: BridgeRouteType;
}
export declare function loadBridgeRegistry(path: string): Promise<LoadedBridgeRegistry>;
export declare function bridgeRegistrySummary(loaded: LoadedBridgeRegistry): {
    source: string;
    schemaVersion: number | undefined;
    network: string | undefined;
    issuer: string | undefined;
    epochHours: number;
    disclaimer: string | undefined;
    contentHash: string;
    bytes: number;
    updatedAt: string | undefined;
    routeCount: number;
    routeTypes: BridgeRouteType[];
    statuses: BridgeRouteStatus[];
    assets: string[];
};
export declare function listBridgeRoutes(registry: BridgeRegistry, args?: {
    asset?: string;
    sourceChain?: string;
    destinationChain?: string;
    status?: BridgeRouteStatus;
    routeType?: BridgeRouteType;
    limit?: number;
}): BridgeRoute[];
export declare function getBridgeRoute(registry: BridgeRegistry, id: string): BridgeRoute;
export declare function selectBridgeRoute(registry: BridgeRegistry, args: {
    asset: string;
    sourceChain?: string;
    destinationChain?: string;
}): BridgeRoute | null;
export declare function quoteBridgeRoute(route: BridgeRoute, args: {
    amount: string;
    asset?: string;
    epochHours?: number;
}): BridgeQuote;
export declare function bridgeCooldownMatrix(registry: BridgeRegistry): {
    routeId: string;
    sourceChain: string;
    destinationChain: string;
    asset: string;
    routeType: BridgeRouteType;
    status: BridgeRouteStatus;
    cooldown: {
        epochs?: number;
        hours: number;
        label: string;
    };
    finality: {
        threshold?: string;
        notes?: string;
    } | undefined;
    circuitBreaker: {
        enabled?: boolean;
        paused?: boolean;
        reason?: string;
    } | undefined;
}[];
export declare function bridgeStatusSummary(registry: BridgeRegistry): {
    routeId: string;
    displayName: string | undefined;
    status: BridgeRouteStatus;
    routeType: BridgeRouteType;
    circuitBreaker: {
        enabled?: boolean;
        paused?: boolean;
        reason?: string;
    } | undefined;
    drainCap: {
        perEpoch?: string;
        remaining?: string;
        asset?: string;
    } | undefined;
    risk: BridgeRisk;
    attention: boolean;
}[];
