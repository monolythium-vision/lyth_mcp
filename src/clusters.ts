import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { canonicalize } from "./runbooks.js";

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

export async function loadClusterRegistry(path: string): Promise<LoadedClusterRegistry> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as ClusterRegistry | ClusterRecord[];
  const registry = Array.isArray(parsed) ? { clusters: parsed } : parsed;
  if (!Array.isArray(registry.clusters)) {
    throw new Error("cluster registry must be an array or an object with a clusters array");
  }
  const stats = await stat(path);
  const canonical = canonicalize(registry);
  return {
    source: path,
    registry,
    contentHash: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
    bytes: Buffer.byteLength(raw),
    updatedAt: stats.mtime.toISOString(),
  };
}

export function clusterRegistrySummary(loaded: LoadedClusterRegistry) {
  const regions = [...new Set(loaded.registry.clusters.map((cluster) => cluster.region).filter(Boolean))].sort();
  const statuses = [...new Set(loaded.registry.clusters.map((cluster) => cluster.status))].sort();
  const services = [...new Set(loaded.registry.clusters.flatMap((cluster) => cluster.serviceTiers?.map((service) => service.type) ?? []))].sort();
  return {
    source: loaded.source,
    schemaVersion: loaded.registry.schemaVersion,
    network: loaded.registry.network,
    issuer: loaded.registry.issuer,
    disclaimer: loaded.registry.disclaimer,
    contentHash: loaded.contentHash,
    bytes: loaded.bytes,
    updatedAt: loaded.updatedAt,
    clusterCount: loaded.registry.clusters.length,
    operatorCount: loaded.registry.operators?.length ?? 0,
    foundationControlledCount: loaded.registry.clusters.filter((cluster) => cluster.foundationControlled).length,
    regions,
    statuses,
    services,
  };
}

export function listClusters(registry: ClusterRegistry, args: {
  query?: string;
  region?: string;
  jurisdiction?: string;
  status?: ClusterStatus;
  serviceType?: ClusterServiceType;
  foundationControlled?: boolean;
  gpuRequired?: boolean;
  minOpenSeats?: number;
  limit?: number;
} = {}): ClusterRecord[] {
  const query = args.query?.toLowerCase();
  return registry.clusters
    .filter((cluster) => !query || canonicalize(cluster).toLowerCase().includes(query))
    .filter((cluster) => !args.region || same(cluster.region, args.region))
    .filter((cluster) => !args.jurisdiction || same(cluster.jurisdiction, args.jurisdiction))
    .filter((cluster) => !args.status || cluster.status === args.status)
    .filter((cluster) => args.foundationControlled === undefined || Boolean(cluster.foundationControlled) === args.foundationControlled)
    .filter((cluster) => args.gpuRequired === undefined || Boolean(cluster.hardware?.gpu) === args.gpuRequired)
    .filter((cluster) => !args.serviceType || cluster.serviceTiers?.some((service) => service.type === args.serviceType))
    .filter((cluster) => args.minOpenSeats === undefined || (cluster.operatorSeats?.open ?? 0) >= args.minOpenSeats)
    .sort((a, b) => clusterScore(b) - clusterScore(a))
    .slice(0, args.limit ?? 50);
}

export function getCluster(registry: ClusterRegistry, id: string): ClusterRecord {
  const cluster = registry.clusters.find((item) => item.id === id);
  if (!cluster) {
    throw new Error(`cluster '${id}' not found`);
  }
  return cluster;
}

export function clusterReputation(cluster: ClusterRecord) {
  const warnings: string[] = [];
  const labels: string[] = [];
  const score = clusterScore(cluster);
  if (cluster.foundationControlled) {
    warnings.push("Foundation-controlled cluster: good bootstrap reliability, weaker decentralization for delegation routing.");
    labels.push("foundation_controlled");
  }
  if (cluster.status !== "active") {
    warnings.push(`Cluster status is ${cluster.status}; avoid production routing until active.`);
    labels.push(cluster.status);
  }
  if ((cluster.reputation?.slashingIncidents ?? 0) > 0) {
    warnings.push(`Cluster has ${cluster.reputation?.slashingIncidents} slashing incident(s).`);
    labels.push("slashing_history");
  }
  if ((cluster.reputation?.uptime30d ?? 0) > 0 && (cluster.reputation?.uptime30d ?? 0) < 99.5) {
    warnings.push(`30d uptime ${cluster.reputation?.uptime30d}% is below the 99.5% planning threshold.`);
    labels.push("uptime_watch");
  }
  if ((cluster.diversity?.decentralizationScore ?? 0) >= 85) {
    labels.push("high_decentralization");
  }
  if (cluster.hardware?.gpu || cluster.serviceTiers?.some((service) => service.type === "prover")) {
    labels.push("gpu_prover");
  }
  return {
    clusterId: cluster.id,
    displayName: cluster.displayName,
    score,
    level: score >= 85 ? "low" : score >= 70 ? "medium" : score >= 50 ? "high" : "blocked",
    labels,
    warnings,
    reputation: cluster.reputation,
    diversity: cluster.diversity,
    serviceTiers: cluster.serviceTiers,
    assumptions: [
      "This is local MCP planning metadata, not a live validator selection result.",
      "TODO(mainnet): replace with signed cluster registry, live uptime, slashing, attestation, and quorum data.",
    ],
  };
}

export function clusterFoundationFlag(cluster: ClusterRecord) {
  return {
    clusterId: cluster.id,
    foundationControlled: Boolean(cluster.foundationControlled),
    explanation: cluster.foundationControlled
      ? "Foundation-controlled cluster. Useful for bootstrap operations, but not the best default for maximum decentralization."
      : "Not marked foundation-controlled in the local registry.",
    stakingGuidance: cluster.foundationControlled
      ? "Prefer community/non-foundation clusters for max-decentralization delegation unless reliability is the priority."
      : "Potential candidate for decentralization-oriented delegation, subject to reputation, uptime, and cap checks.",
  };
}

export function clusterSunsetStatus(cluster: ClusterRecord) {
  return {
    clusterId: cluster.id,
    status: cluster.status,
    planned: Boolean(cluster.sunset?.planned || cluster.status === "sunsetting" || cluster.status === "retired"),
    sunset: cluster.sunset,
    warning: cluster.status === "sunsetting" || cluster.status === "retired"
      ? "Avoid new delegation or service routing to this cluster."
      : cluster.sunset?.planned
        ? "Sunset is planned; check replacement routing before delegating."
        : undefined,
  };
}

export function listOperators(registry: ClusterRegistry, args: {
  query?: string;
  region?: string;
  clusterId?: string;
  foundationControlled?: boolean;
  openSeatInterest?: boolean;
  limit?: number;
} = {}): OperatorRecord[] {
  const query = args.query?.toLowerCase();
  return (registry.operators ?? [])
    .filter((operator) => !query || canonicalize(operator).toLowerCase().includes(query))
    .filter((operator) => !args.region || same(operator.region, args.region))
    .filter((operator) => !args.clusterId || operator.clusterIds?.includes(args.clusterId))
    .filter((operator) => args.foundationControlled === undefined || Boolean(operator.foundationControlled) === args.foundationControlled)
    .filter((operator) => args.openSeatInterest === undefined || Boolean(operator.openSeatInterest) === args.openSeatInterest)
    .sort((a, b) => (b.reputation?.score ?? 0) - (a.reputation?.score ?? 0))
    .slice(0, args.limit ?? 50);
}

export function getOperator(registry: ClusterRegistry, id: string): OperatorRecord {
  const operator = (registry.operators ?? []).find((item) => item.id === id);
  if (!operator) {
    throw new Error(`operator '${id}' not found`);
  }
  return operator;
}

export function operatorStatus(registry: ClusterRegistry, operator: OperatorRecord) {
  const clusters = operator.clusterIds?.map((id) => {
    try {
      return getCluster(registry, id);
    } catch {
      return null;
    }
  }).filter((cluster): cluster is ClusterRecord => cluster !== null) ?? [];
  return {
    operator,
    clusters,
    openSeats: clusters.reduce((sum, cluster) => sum + (cluster.operatorSeats?.open ?? 0), 0),
    attestation: operator.attestation,
    warnings: [
      ...(operator.foundationControlled ? ["Foundation-controlled operator."] : []),
      ...(operator.attestation?.status !== "verified" ? ["Operator attestation is not verified in local metadata."] : []),
    ],
    assumptions: [
      "TODO(mainnet): replace local operator metadata with signed operator registry, TPM attestation, and live seat availability.",
    ],
  };
}

export function searchServices(registry: ClusterRegistry, args: {
  serviceType: ClusterServiceType;
  region?: string;
  activeOnly?: boolean;
  gpuClass?: string;
  maxLatencyMs?: number;
  limit?: number;
}) {
  return registry.clusters
    .filter((cluster) => !args.region || same(cluster.region, args.region))
    .flatMap((cluster) => (cluster.serviceTiers ?? [])
      .filter((service) => service.type === args.serviceType)
      .filter((service) => !args.activeOnly || service.status === "active")
      .filter((service) => !args.gpuClass || same(service.gpuClass, args.gpuClass))
      .filter((service) => args.maxLatencyMs === undefined || (service.proofLatencyMsP50 ?? Number.POSITIVE_INFINITY) <= args.maxLatencyMs)
      .map((service) => ({
        clusterId: cluster.id,
        clusterDisplayName: cluster.displayName,
        region: cluster.region,
        jurisdiction: cluster.jurisdiction,
        foundationControlled: Boolean(cluster.foundationControlled),
        reputation: clusterReputation(cluster),
        service,
      })))
    .sort((a, b) => serviceScore(b) - serviceScore(a))
    .slice(0, args.limit ?? 50);
}

function clusterScore(cluster: ClusterRecord): number {
  const reputation = cluster.reputation?.score ?? 50;
  const uptime = cluster.reputation?.uptime30d ? Math.min(100, cluster.reputation.uptime30d) : 50;
  const diversity = cluster.diversity?.decentralizationScore ?? 50;
  const statusPenalty = cluster.status === "active" ? 0 : cluster.status === "degraded" ? 15 : 35;
  const foundationPenalty = cluster.foundationControlled ? 8 : 0;
  const slashingPenalty = (cluster.reputation?.slashingIncidents ?? 0) * 20;
  return Math.max(0, Math.round(reputation * 0.45 + uptime * 0.2 + diversity * 0.35 - statusPenalty - foundationPenalty - slashingPenalty));
}

function serviceScore(entry: { reputation: ReturnType<typeof clusterReputation>; service: ClusterServiceTier }): number {
  const uptime = entry.service.uptime30d ?? 0;
  const latencyBonus = entry.service.proofLatencyMsP50 ? Math.max(0, 20 - entry.service.proofLatencyMsP50 / 100) : 0;
  const statusBonus = entry.service.status === "active" ? 20 : 0;
  return entry.reputation.score + uptime / 5 + latencyBonus + statusBonus;
}

function same(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}
