import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { canonicalize } from "./runbooks.js";

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

const PCR_MEANINGS: Record<string, string> = {
  "0": "Firmware and BIOS measurement. Changes can mean firmware upgrade or boot-chain tampering.",
  "2": "Option ROM / peripheral firmware measurement. Changes can indicate hardware or firmware changes.",
  "4": "Bootloader measurement. Changes should match the approved node boot profile.",
  "7": "Secure Boot policy measurement. Mismatch means Secure Boot state or keys differ from expectation.",
  "11": "Kernel, initrd, or application-specific measured profile depending on node policy.",
};

export async function loadNodeRegistry(path: string): Promise<LoadedNodeRegistry> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as NodeRegistry | NodeRecord[];
  const registry = Array.isArray(parsed) ? { nodes: parsed } : parsed;
  if (!Array.isArray(registry.nodes)) {
    throw new Error("node registry must be an array or an object with a nodes array");
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

export function nodeRegistrySummary(loaded: LoadedNodeRegistry) {
  const roles = [...new Set(loaded.registry.nodes.map((node) => node.role))].sort();
  const statuses = [...new Set(loaded.registry.nodes.map((node) => node.status))].sort();
  const hostingClasses = [...new Set(loaded.registry.nodes.map((node) => node.hosting?.class).filter(Boolean))].sort();
  const attestationStatuses = [...new Set(loaded.registry.nodes.map((node) => node.attestation?.status ?? "missing"))].sort();
  return {
    source: loaded.source,
    schemaVersion: loaded.registry.schemaVersion,
    network: loaded.registry.network,
    issuer: loaded.registry.issuer,
    disclaimer: loaded.registry.disclaimer,
    contentHash: loaded.contentHash,
    bytes: loaded.bytes,
    updatedAt: loaded.updatedAt,
    nodeCount: loaded.registry.nodes.length,
    roles,
    statuses,
    hostingClasses,
    attestationStatuses,
  };
}

export function listNodes(registry: NodeRegistry, args: {
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
} = {}): NodeRecord[] {
  const query = args.query?.toLowerCase();
  return registry.nodes
    .filter((node) => !query || canonicalize(node).toLowerCase().includes(query))
    .filter((node) => !args.clusterId || node.clusterId === args.clusterId)
    .filter((node) => !args.operatorId || node.operatorId === args.operatorId)
    .filter((node) => !args.role || node.role === args.role)
    .filter((node) => !args.status || node.status === args.status)
    .filter((node) => !args.region || same(node.region, args.region))
    .filter((node) => !args.hostingClass || node.hosting?.class === args.hostingClass)
    .filter((node) => !args.attestationStatus || (node.attestation?.status ?? "missing") === args.attestationStatus)
    .filter((node) => args.gpuRequired === undefined || Boolean(node.hardware?.gpu) === args.gpuRequired)
    .filter((node) => args.tpmRequired === undefined || Boolean(node.hardware?.tpm) === args.tpmRequired)
    .sort((a, b) => nodeScore(b) - nodeScore(a))
    .slice(0, args.limit ?? 50);
}

export function getNode(registry: NodeRegistry, id: string): NodeRecord {
  const node = registry.nodes.find((item) => item.id === id);
  if (!node) {
    throw new Error(`node '${id}' not found`);
  }
  return node;
}

export function nodeAttestation(node: NodeRecord) {
  const pcrs = node.attestation?.pcrs ?? {};
  const expected = node.attestation?.expectedPcrs ?? {};
  const mismatches = Object.entries(expected)
    .filter(([pcr, value]) => pcrs[pcr] !== value)
    .map(([pcr, value]) => ({ pcr, expected: value, actual: pcrs[pcr] ?? null, meaning: PCR_MEANINGS[pcr] ?? "Unknown PCR meaning." }));
  const missingExpected = Object.keys(expected).filter((pcr) => !pcrs[pcr]);
  const violations = [
    ...(!node.hardware?.tpm ? ["Node does not report TPM support."] : []),
    ...(node.attestation?.status === "missing" ? ["Attestation is missing."] : []),
    ...(node.attestation?.status === "expired" ? ["Attestation is expired."] : []),
    ...(mismatches.length ? [`${mismatches.length} PCR value(s) differ from expected profile.`] : []),
  ];
  const warnings = [
    ...(node.attestation?.status !== "verified" ? [`Attestation status is ${node.attestation?.status ?? "missing"}, not verified.`] : []),
    ...(!node.hardware?.secureBoot ? ["Secure Boot is not reported as enabled."] : []),
    ...(node.status !== "active" ? [`Node status is ${node.status}; avoid production routing.`] : []),
    ...(missingExpected.length ? [`Missing PCR value(s): ${missingExpected.join(", ")}.`] : []),
    node.attestation?.notes,
  ].filter((item): item is string => Boolean(item));
  return {
    ok: violations.length === 0,
    nodeId: node.id,
    clusterId: node.clusterId,
    operatorId: node.operatorId,
    status: node.attestation?.status ?? "missing",
    method: node.attestation?.method,
    measuredAt: node.attestation?.measuredAt,
    quoteHash: node.attestation?.quoteHash,
    pcrs,
    expectedPcrs: expected,
    mismatches,
    violations,
    warnings,
    assumptions: [
      "This MCP only checks local attestation metadata. It does not verify TPM quote signatures.",
      "TODO(mainnet): verify quote signature against registered AK, signed PCR profile, firmware policy, and node identity.",
    ],
  };
}

export function explainPcr(node: NodeRecord, pcr?: string) {
  const pcrs = node.attestation?.pcrs ?? {};
  const expected = node.attestation?.expectedPcrs ?? {};
  const keys = pcr ? [pcr] : [...new Set([...Object.keys(PCR_MEANINGS), ...Object.keys(pcrs), ...Object.keys(expected)])].sort((a, b) => Number(a) - Number(b));
  return {
    nodeId: node.id,
    pcr: pcr ?? "all",
    entries: keys.map((key) => ({
      pcr: key,
      actual: pcrs[key],
      expected: expected[key],
      matchesExpected: expected[key] === undefined ? "no_expected_value" : pcrs[key] === expected[key],
      meaning: PCR_MEANINGS[key] ?? "Unknown PCR in local explainer. TODO(mainnet): source PCR policy from signed node profile.",
    })),
    explanation: "PCRs are measured-boot registers. Matching expected PCRs suggests the node booted the approved firmware/bootloader/Secure Boot/kernel profile; mismatches need operator review.",
  };
}

export function nodeDiversityScore(registry: NodeRegistry, args: {
  clusterId?: string;
  operatorId?: string;
  region?: string;
  role?: NodeRole;
} = {}) {
  const nodes = listNodes(registry, { ...args, limit: 500 });
  const asns = unique(nodes.map((node) => node.hosting?.asn).filter((value): value is number => typeof value === "number").map(String));
  const providers = unique(nodes.map((node) => node.hosting?.provider).filter(Boolean) as string[]);
  const countries = unique(nodes.map((node) => node.hosting?.country).filter(Boolean) as string[]);
  const hostingClasses = unique(nodes.map((node) => node.hosting?.class).filter(Boolean) as string[]);
  const operators = unique(nodes.map((node) => node.operatorId).filter(Boolean) as string[]);
  const clusters = unique(nodes.map((node) => node.clusterId));
  const score = Math.min(100, Math.round(
    Math.min(asns.length, 8) * 12
    + Math.min(providers.length, 6) * 8
    + Math.min(countries.length, 5) * 7
    + Math.min(hostingClasses.length, 4) * 6
    + Math.min(operators.length, 8) * 5,
  ));
  const warnings = [
    ...(nodes.length === 0 ? ["No nodes matched this scope."] : []),
    ...(asns.length <= 1 && nodes.length > 1 ? ["All matched nodes share one ASN; network-level diversity is weak."] : []),
    ...(providers.length <= 1 && nodes.length > 1 ? ["All matched nodes share one provider; hosting-provider diversity is weak."] : []),
    ...(countries.length <= 1 && nodes.length > 1 ? ["All matched nodes share one country; geographic diversity is weak."] : []),
  ];
  return {
    ok: warnings.length === 0,
    scope: args,
    score,
    level: score >= 80 ? "strong" : score >= 55 ? "moderate" : "weak",
    counts: {
      nodes: nodes.length,
      asns: asns.length,
      providers: providers.length,
      countries: countries.length,
      hostingClasses: hostingClasses.length,
      operators: operators.length,
      clusters: clusters.length,
    },
    asns,
    providers,
    countries,
    hostingClasses,
    operators,
    clusters,
    warnings,
    assumptions: [
      "This is local node metadata, not a Sybil-proof diversity proof.",
      "TODO(mainnet): include live node identity, AS map, stake weight, and TPM attestation in the diversity score.",
    ],
  };
}

export function nodeHostingClass(node: NodeRecord) {
  const hosting = node.hosting;
  const klass = hosting?.class ?? "unknown";
  const risk = klass === "community_baremetal"
    ? "low"
    : klass === "cloud_dedicated" || klass === "cloud_gpu"
      ? "medium"
      : "high";
  return {
    nodeId: node.id,
    hosting,
    risk,
    explanation: hostingExplanation(klass),
    warnings: [
      ...(klass === "cloud_shared" ? ["Shared-cloud hosting has higher correlated-failure and noisy-neighbor risk."] : []),
      ...(klass === "planned_mixed" ? ["Planned hosting class is not a production routing signal."] : []),
      ...(!node.hardware?.tpm ? ["No TPM signal; cannot treat hosting claim as attested."] : []),
    ],
  };
}

function nodeScore(node: NodeRecord): number {
  const attestation = node.attestation?.status === "verified" ? 30 : node.attestation?.status === "draft" ? 10 : 0;
  const tpm = node.hardware?.tpm ? 20 : 0;
  const secureBoot = node.hardware?.secureBoot ? 15 : 0;
  const status = node.status === "active" ? 20 : node.status === "degraded" ? 5 : 0;
  const hosting = node.hosting?.class === "community_baremetal" ? 15 : node.hosting?.class === "cloud_dedicated" ? 10 : 5;
  return attestation + tpm + secureBoot + status + hosting;
}

function hostingExplanation(klass: string) {
  switch (klass) {
    case "community_baremetal":
      return "Community bare metal improves operator sovereignty and provider diversity, but needs strong remote attestation and physical ops discipline.";
    case "cloud_dedicated":
      return "Dedicated cloud reduces hardware management burden but increases provider concentration risk.";
    case "cloud_gpu":
      return "Cloud GPU is useful for prover capacity but should be balanced against provider lock-in and cost volatility.";
    case "cloud_shared":
      return "Shared cloud is acceptable for drafts and light services, but weak for validator/prover production duties.";
    case "planned_mixed":
      return "Planned/mixed hosting is not a verified production class yet.";
    default:
      return "Unknown hosting class. Treat as unverified until node metadata is signed and attested.";
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function same(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}
