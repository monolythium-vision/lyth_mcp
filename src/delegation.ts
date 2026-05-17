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
