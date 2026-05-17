import { createHash } from "node:crypto";
import {
  clusterFoundationFlag,
  clusterReputation,
  getCluster,
  listClusters,
  type ClusterRecord,
  type ClusterRegistry,
} from "./clusters.js";

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

const PHASES: Record<DelegationPhase, DelegationPhaseConfig> = {
  bootstrap: {
    phase: "bootstrap",
    perClusterCapPercent: 25,
    minimumClusters: 4,
    overCapGraceEpochs: 4,
    maxRewardTaperPercent: 50,
    explanation: "Bootstrap phase tolerates higher per-cluster concentration while the operator set is still forming.",
  },
  growth: {
    phase: "growth",
    perClusterCapPercent: 15,
    minimumClusters: 7,
    overCapGraceEpochs: 2,
    maxRewardTaperPercent: 65,
    explanation: "Growth phase pushes stake toward more clusters while preserving a short rebalancing grace period.",
  },
  mature: {
    phase: "mature",
    perClusterCapPercent: 10,
    minimumClusters: 10,
    overCapGraceEpochs: 1,
    maxRewardTaperPercent: 80,
    explanation: "Mature phase strongly penalizes concentration and expects broad delegation.",
  },
};

export function delegationPhaseConfig(phase: DelegationPhase = "growth"): DelegationPhaseConfig {
  return PHASES[phase];
}

export function explainDelegationCaps(input: DelegationCapInput = {}) {
  const phase = delegationPhaseConfig(input.phase ?? "growth");
  const total = parseOptional(input.totalDelegatedStake);
  const current = parseOptional(input.currentClusterStake) ?? 0;
  const additional = parseOptional(input.intendedAdditionalStake) ?? 0;
  const projected = current + additional;
  const capAmount = total === undefined ? undefined : total * (phase.perClusterCapPercent / 100);
  const projectedPercent = total && total > 0 ? (projected / total) * 100 : undefined;
  const overCapAmount = capAmount === undefined ? undefined : Math.max(0, projected - capAmount);
  const overCap = overCapAmount === undefined ? undefined : overCapAmount > 0;
  const selectedClusterCount = input.selectedClusterCount ?? 0;
  const diversityOk = selectedClusterCount >= phase.minimumClusters;
  const overCapEpochs = input.overCapEpochs ?? 0;
  const graceRemaining = Math.max(0, phase.overCapGraceEpochs - overCapEpochs);
  const rewardTaper = overCap
    ? rewardTaperPercent({
        overCapEpochs,
        grace: phase.overCapGraceEpochs,
        max: phase.maxRewardTaperPercent,
        projectedPercent,
        capPercent: phase.perClusterCapPercent,
      })
    : 0;
  const warnings = [
    ...(overCap ? [`Projected cluster stake exceeds the ${phase.perClusterCapPercent}% phase cap.`] : []),
    ...(!diversityOk ? [`Selected cluster count ${selectedClusterCount} is below minimum diversification target ${phase.minimumClusters}.`] : []),
    ...(overCap && graceRemaining > 0 ? [`Over-cap grace remains for ${graceRemaining} epoch(s) before full taper applies.`] : []),
    ...(overCap && graceRemaining === 0 ? ["Over-cap grace is exhausted; tapered rewards should apply until rebalanced."] : []),
  ];
  return {
    ok: warnings.length === 0,
    clusterId: input.clusterId,
    phase,
    totals: {
      totalDelegatedStake: input.totalDelegatedStake,
      currentClusterStake: input.currentClusterStake,
      intendedAdditionalStake: input.intendedAdditionalStake,
      projectedClusterStake: total === undefined ? undefined : format(projected),
      capAmount: capAmount === undefined ? undefined : format(capAmount),
      projectedClusterSharePercent: projectedPercent === undefined ? undefined : round(projectedPercent),
      overCapAmount: overCapAmount === undefined ? undefined : format(overCapAmount),
    },
    diversification: {
      selectedClusterCount,
      minimumClusters: phase.minimumClusters,
      ok: diversityOk,
    },
    taper: {
      overCap: Boolean(overCap),
      overCapEpochs,
      graceEpochs: phase.overCapGraceEpochs,
      graceRemaining,
      rewardTaperPercent: rewardTaper,
      estimatedRewardMultiplier: round(Math.max(0, 1 - rewardTaper / 100)),
    },
    warnings,
    explanation: [
      phase.explanation,
      `Per-cluster cap: ${phase.perClusterCapPercent}% of delegated stake.`,
      `Minimum diversification target: ${phase.minimumClusters} clusters.`,
      `Over-cap grace: ${phase.overCapGraceEpochs} epoch(s), then tapered rewards up to ${phase.maxRewardTaperPercent}%.`,
    ],
    assumptions: [
      "This is a local MCP policy explainer, not a live staking transaction or consensus rule.",
      "TODO(mainnet): replace static phase defaults with signed governance/staking parameters from core/indexer.",
      "TODO(core): connect to stake_status, delegate_draft, rebalance_draft, undelegate_draft, and autovote_simulate when available.",
    ],
  };
}

export function stakeStatus(registry: ClusterRegistry, input: {
  positions?: DelegationPosition[];
  phase?: DelegationPhase;
} = {}) {
  const positions = normalizePositions(input.positions ?? []);
  const total = positions.reduce((sum, position) => sum + parseAmount(position.amount), 0);
  const phase = input.phase ?? "growth";
  const selectedClusterCount = positions.filter((position) => parseAmount(position.amount) > 0).length;
  const clusters = positions.map((position) => {
    const cluster = safeCluster(registry, position.clusterId);
    const cap = explainDelegationCaps({
      phase,
      clusterId: position.clusterId,
      totalDelegatedStake: format(total),
      currentClusterStake: position.amount,
      selectedClusterCount,
    });
    return {
      position,
      cluster,
      reputation: cluster ? clusterReputation(cluster) : undefined,
      foundation: cluster ? clusterFoundationFlag(cluster) : undefined,
      cap,
    };
  });
  const warnings = [
    ...(selectedClusterCount < delegationPhaseConfig(phase).minimumClusters
      ? [`Delegation is spread across ${selectedClusterCount} cluster(s), below the ${delegationPhaseConfig(phase).minimumClusters} cluster target.`]
      : []),
    ...clusters.flatMap((entry) => entry.cap.warnings),
    ...clusters.filter((entry) => !entry.cluster).map((entry) => `Unknown cluster ${entry.position.clusterId}.`),
  ];
  return {
    ok: warnings.length === 0,
    phase: delegationPhaseConfig(phase),
    totalDelegatedStake: format(total),
    selectedClusterCount,
    positions: clusters,
    warnings: [...new Set(warnings)],
    assumptions: [
      "This is local planning only, not live staking state.",
      "TODO(core): replace position input with stake_status from core/indexer.",
    ],
  };
}

export function delegateDraft(registry: ClusterRegistry, input: {
  clusterId: string;
  amount: string;
  mode?: DelegationMode;
  phase?: DelegationPhase;
  positions?: DelegationPosition[];
}) {
  const cluster = getCluster(registry, input.clusterId);
  const positions = normalizePositions(input.positions ?? []);
  const current = positions.find((position) => position.clusterId === input.clusterId)?.amount ?? "0";
  const totalAfter = positions.reduce((sum, position) => sum + parseAmount(position.amount), 0) + parseAmount(input.amount);
  const selectedAfter = new Set([...positions.filter((position) => parseAmount(position.amount) > 0).map((position) => position.clusterId), input.clusterId]).size;
  const cap = explainDelegationCaps({
    phase: input.phase ?? "growth",
    clusterId: input.clusterId,
    totalDelegatedStake: format(totalAfter),
    currentClusterStake: current,
    intendedAdditionalStake: input.amount,
    selectedClusterCount: selectedAfter,
  });
  return {
    draftId: draftId("delegate", input),
    operation: "delegate",
    mode: input.mode ?? "custom",
    cluster,
    amount: input.amount,
    cap,
    reputation: clusterReputation(cluster),
    foundation: clusterFoundationFlag(cluster),
    warnings: cap.warnings,
    unsigned: true,
    todo: [
      "TODO(core): replace this with delegate_draft from the staking module.",
      "TODO(wallet): require explicit user approval before signing/submitting any delegation transaction.",
    ],
  };
}

export function undelegateDraft(registry: ClusterRegistry, input: {
  clusterId: string;
  amount: string;
  positions?: DelegationPosition[];
  reason?: string;
}) {
  const cluster = getCluster(registry, input.clusterId);
  const current = normalizePositions(input.positions ?? []).find((position) => position.clusterId === input.clusterId)?.amount ?? "0";
  const amount = parseAmount(input.amount);
  const currentAmount = parseAmount(current);
  const warnings = [
    ...(amount > currentAmount ? [`Undelegate amount ${input.amount} exceeds current local position ${current}.`] : []),
    "Undelegation may have an unbonding/cooldown period once core staking is live.",
  ];
  return {
    draftId: draftId("undelegate", input),
    operation: "undelegate",
    cluster,
    amount: input.amount,
    currentPosition: current,
    reason: input.reason,
    warnings,
    unsigned: true,
    todo: [
      "TODO(core): replace this with undelegate_draft from the staking module.",
      "TODO(indexer): show live unbonding period and reward impact.",
    ],
  };
}

export function rebalanceDraft(registry: ClusterRegistry, input: {
  mode?: DelegationMode;
  phase?: DelegationPhase;
  positions?: DelegationPosition[];
  targetClusterCount?: number;
}) {
  const positions = normalizePositions(input.positions ?? []);
  const total = positions.reduce((sum, position) => sum + parseAmount(position.amount), 0);
  const phase = delegationPhaseConfig(input.phase ?? "growth");
  const targetClusterCount = input.targetClusterCount ?? phase.minimumClusters;
  const candidates = rankClusters(registry, input.mode ?? "max_decentralization")
    .slice(0, targetClusterCount);
  const targetAmount = candidates.length > 0 ? total / candidates.length : 0;
  const operations = candidates.map((cluster) => {
    const current = parseAmount(positions.find((position) => position.clusterId === cluster.id)?.amount ?? "0");
    return {
      clusterId: cluster.id,
      displayName: cluster.displayName,
      currentAmount: format(current),
      targetAmount: format(targetAmount),
      delta: format(targetAmount - current),
      action: targetAmount > current ? "delegate_more" : targetAmount < current ? "undelegate_or_rebalance_out" : "hold",
      reputation: clusterReputation(cluster),
      foundation: clusterFoundationFlag(cluster),
    };
  });
  return {
    draftId: draftId("rebalance", input),
    operation: "rebalance",
    mode: input.mode ?? "max_decentralization",
    phase,
    totalDelegatedStake: format(total),
    targetClusterCount,
    operations,
    warnings: [
      ...(total === 0 ? ["No local position amounts supplied; rebalance plan has zero target amounts."] : []),
      "This is a planning draft only. It does not build signed staking calls.",
    ],
    todo: [
      "TODO(core): replace this with rebalance_draft from the staking module.",
      "TODO(indexer): include live rewards, caps, unbonding queues, and slashing risk.",
    ],
  };
}

export function autovoteSimulate(registry: ClusterRegistry, input: {
  mode?: DelegationMode;
  phase?: DelegationPhase;
  positions?: DelegationPosition[];
  candidateLimit?: number;
}) {
  const mode = input.mode ?? "max_decentralization";
  const phase = input.phase ?? "growth";
  const ranked = rankClusters(registry, mode).slice(0, input.candidateLimit ?? delegationPhaseConfig(phase).minimumClusters);
  return {
    simulationId: draftId("autovote", input),
    mode,
    phase: delegationPhaseConfig(phase),
    currentStatus: stakeStatus(registry, { positions: input.positions, phase }),
    rankedCandidates: ranked.map((cluster, index) => ({
      rank: index + 1,
      clusterId: cluster.id,
      displayName: cluster.displayName,
      score: delegationScore(cluster, mode),
      reputation: clusterReputation(cluster),
      foundation: clusterFoundationFlag(cluster),
      rationale: rationale(cluster, mode),
    })),
    warnings: [
      "Simulation only. It does not vote, delegate, rebalance, or sign.",
      "TODO(core): connect to live autovote policy, staking parameters, and governance votes.",
    ],
  };
}

function rewardTaperPercent(args: {
  overCapEpochs: number;
  grace: number;
  max: number;
  projectedPercent?: number;
  capPercent: number;
}): number {
  if (args.overCapEpochs < args.grace) {
    return 0;
  }
  const concentrationPenalty = args.projectedPercent === undefined
    ? 20
    : Math.min(args.max, ((args.projectedPercent - args.capPercent) / args.capPercent) * args.max);
  const epochPenalty = Math.min(args.max, Math.max(0, args.overCapEpochs - args.grace + 1) * 10);
  return round(Math.min(args.max, concentrationPenalty + epochPenalty));
}

function parseOptional(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid non-negative decimal value: ${value}`);
  }
  return parsed;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function format(value: number): string {
  return round(value).toString();
}

function normalizePositions(positions: DelegationPosition[]): DelegationPosition[] {
  const totals = new Map<string, number>();
  for (const position of positions) {
    totals.set(position.clusterId, (totals.get(position.clusterId) ?? 0) + parseAmount(position.amount));
  }
  return [...totals.entries()].map(([clusterId, amount]) => ({ clusterId, amount: format(amount) }));
}

function safeCluster(registry: ClusterRegistry, clusterId: string): ClusterRecord | null {
  try {
    return getCluster(registry, clusterId);
  } catch {
    return null;
  }
}

function rankClusters(registry: ClusterRegistry, mode: DelegationMode): ClusterRecord[] {
  return listClusters(registry, { status: "active", limit: 500 })
    .sort((a, b) => delegationScore(b, mode) - delegationScore(a, mode));
}

function delegationScore(cluster: ClusterRecord, mode: DelegationMode): number {
  const rep = clusterReputation(cluster);
  const diversity = cluster.diversity?.decentralizationScore ?? 50;
  const openSeats = cluster.operatorSeats?.open ?? 0;
  const foundationPenalty = cluster.foundationControlled ? 25 : 0;
  const serviceBonus = cluster.serviceTiers?.some((service) => service.status === "active") ? 8 : 0;
  if (mode === "max_yield") {
    return rep.score + serviceBonus + Math.min(10, openSeats * 2) - foundationPenalty / 3;
  }
  if (mode === "max_diversity") {
    return diversity + Math.min(20, openSeats * 4) - foundationPenalty;
  }
  if (mode === "max_decentralization") {
    return diversity + rep.score / 2 + Math.min(20, openSeats * 5) - foundationPenalty;
  }
  return rep.score + diversity / 2 - foundationPenalty / 2;
}

function rationale(cluster: ClusterRecord, mode: DelegationMode): string {
  if (mode === "max_yield") {
    return "Ranks by reputation/service availability first, with smaller decentralization penalties.";
  }
  if (mode === "max_diversity") {
    return "Ranks by diversity score and open seats, avoiding concentrated/foundation-controlled clusters.";
  }
  if (mode === "max_decentralization") {
    return "Ranks by decentralization score, open seats, and reputation while penalizing foundation control.";
  }
  return `Custom/default ranking for ${cluster.displayName ?? cluster.id}.`;
}

function draftId(kind: string, input: unknown): string {
  return `${kind}_${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 12)}`;
}

function parseAmount(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid non-negative decimal amount: ${value}`);
  }
  return parsed;
}
