import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { canonicalize } from "./runbooks.js";
export async function loadClusterRegistry(path) {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
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
export function clusterRegistrySummary(loaded) {
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
export function listClusters(registry, args = {}) {
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
export function getCluster(registry, id) {
    const cluster = registry.clusters.find((item) => item.id === id);
    if (!cluster) {
        throw new Error(`cluster '${id}' not found`);
    }
    return cluster;
}
export function clusterReputation(cluster) {
    const warnings = [];
    const labels = [];
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
export function clusterFoundationFlag(cluster) {
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
export function clusterSunsetStatus(cluster) {
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
export function listOperators(registry, args = {}) {
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
export function getOperator(registry, id) {
    const operator = (registry.operators ?? []).find((item) => item.id === id);
    if (!operator) {
        throw new Error(`operator '${id}' not found`);
    }
    return operator;
}
export function operatorStatus(registry, operator) {
    const clusters = operator.clusterIds?.map((id) => {
        try {
            return getCluster(registry, id);
        }
        catch {
            return null;
        }
    }).filter((cluster) => cluster !== null) ?? [];
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
export function monarchOperatorAssistant(registry, args = {}) {
    const operator = args.operatorId ? getOperator(registry, args.operatorId) : undefined;
    const clusters = args.clusterId
        ? [getCluster(registry, args.clusterId)]
        : listClusters(registry, {
            region: args.region,
            serviceType: args.serviceType,
            status: args.includeDraft ? undefined : "active",
            limit: args.limit ?? 10,
        }).filter((cluster) => !operator || operator.clusterIds?.includes(cluster.id) || operator.openSeatInterest);
    return {
        scope: {
            clusterId: args.clusterId,
            operatorId: args.operatorId,
            region: args.region,
            serviceType: args.serviceType,
            includeDraft: Boolean(args.includeDraft),
        },
        operator: operator ? operatorStatus(registry, operator) : undefined,
        clusters: clusters.map((cluster) => monarchClusterReport(cluster)),
        recommendations: monarchRecommendations(clusters, operator),
        guardrails: [
            "This assistant is for node/operator planning, not consumer wallet UX.",
            "Do not expose validator maintenance, TPM/PCR, quorum, or service ROI controls inside payment/order flows.",
            "TODO(mainnet): replace local metadata with live quorum, update, resource, and revenue telemetry from core/indexer.",
        ],
    };
}
export function monarchClusterReport(cluster) {
    const reputation = clusterReputation(cluster);
    const pressure = resourcePressure(cluster);
    const roi = serviceRoi(cluster);
    return {
        clusterId: cluster.id,
        displayName: cluster.displayName,
        status: cluster.status,
        health: {
            level: reputation.level,
            score: reputation.score,
            uptime30d: cluster.reputation?.uptime30d,
            missedRounds30d: cluster.reputation?.missedRounds30d,
            slashingIncidents: cluster.reputation?.slashingIncidents ?? 0,
            warnings: reputation.warnings,
        },
        quorum: {
            configured: cluster.quorum ?? "unknown",
            explanation: cluster.quorum === "7-of-10"
                ? "Cluster is modeled as 10 operators with a 7-of-10 threshold; losing 4 operators can halt this cluster."
                : "Quorum is local metadata only; verify live consensus configuration before operations.",
            openSeats: cluster.operatorSeats?.open ?? 0,
            totalSeats: cluster.operatorSeats?.total,
        },
        updateStatus: {
            status: cluster.status,
            safeForNewOps: cluster.status === "active",
            note: cluster.status === "active"
                ? "No local update/sunset warning is active."
                : "Cluster is not marked active; avoid new service routing until live status clears.",
            todo: "TODO(mainnet): attach live binary version, upgrade window, and operator rollout status.",
        },
        resourcePressure: pressure,
        serviceRoi: roi,
        operatorSeats: cluster.operatorSeats,
        serviceTiers: cluster.serviceTiers,
        foundation: clusterFoundationFlag(cluster),
        sunset: clusterSunsetStatus(cluster),
        nodeOpsOnly: true,
    };
}
export function searchServices(registry, args) {
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
function resourcePressure(cluster) {
    const totalSeats = cluster.operatorSeats?.total ?? 0;
    const openSeats = cluster.operatorSeats?.open ?? 0;
    const filledSeats = Math.max(0, totalSeats - openSeats);
    const seatPressure = totalSeats > 0 ? filledSeats / totalSeats : 0;
    const activeServices = (cluster.serviceTiers ?? []).filter((service) => service.status === "active");
    const degradedServices = (cluster.serviceTiers ?? []).filter((service) => service.status === "degraded" || service.status === "paused");
    const gpuPressure = cluster.hardware?.gpu && activeServices.some((service) => service.type === "prover")
        ? "gpu_capacity_should_be_monitored"
        : "no_gpu_pressure_signal";
    const level = degradedServices.length > 0 || cluster.status === "degraded"
        ? "high"
        : seatPressure >= 0.9
            ? "medium"
            : cluster.status !== "active"
                ? "high"
                : "low";
    return {
        level,
        seatPressurePercent: Math.round(seatPressure * 100),
        openSeats,
        activeServiceCount: activeServices.length,
        degradedServiceCount: degradedServices.length,
        gpuPressure,
        hardware: cluster.hardware,
        warnings: [
            ...(openSeats <= 1 && totalSeats > 0 ? ["Few open operator seats remain; onboarding flexibility is low."] : []),
            ...(degradedServices.length ? [`${degradedServices.length} service tier(s) are degraded or paused.`] : []),
            ...(cluster.status !== "active" ? [`Cluster status is ${cluster.status}.`] : []),
        ],
    };
}
function serviceRoi(cluster) {
    return (cluster.serviceTiers ?? []).map((service) => {
        const monthly = service.pricePerMonth ? Number(service.pricePerMonth) : undefined;
        const perProof = service.pricePerProof ? Number(service.pricePerProof) : undefined;
        const uptime = service.uptime30d ?? 0;
        const proofLatency = service.proofLatencyMsP50;
        const score = service.type === "prover"
            ? Math.round((uptime / 2) + Math.max(0, 40 - (proofLatency ?? 2000) / 100) - (perProof ?? 0) * 10)
            : Math.round((uptime / 2) + (monthly ? Math.max(0, 30 - monthly / 20) : 10));
        return {
            type: service.type,
            status: service.status,
            pricePerMonth: service.pricePerMonth,
            pricePerProof: service.pricePerProof,
            asset: service.asset,
            uptime30d: service.uptime30d,
            gpuClass: service.gpuClass,
            capacity: service.capacity,
            proofLatencyMsP50: service.proofLatencyMsP50,
            roiScore: Math.max(0, score),
            interpretation: service.type === "prover"
                ? "Prover ROI favors high uptime, low proof latency, and lower per-proof fee."
                : "Service ROI favors high uptime and lower monthly fee.",
            todo: "TODO(mainnet): replace heuristic ROI with live utilization, rewards, operating cost, and SLA revenue data.",
        };
    }).sort((a, b) => b.roiScore - a.roiScore);
}
function monarchRecommendations(clusters, operator) {
    const reports = clusters.map((cluster) => ({ cluster, reputation: clusterReputation(cluster), pressure: resourcePressure(cluster) }));
    const bestHealth = [...reports].sort((a, b) => b.reputation.score - a.reputation.score)[0];
    const openSeats = reports.filter((entry) => (entry.cluster.operatorSeats?.open ?? 0) > 0);
    return [
        bestHealth
            ? `Best health candidate: ${bestHealth.cluster.displayName ?? bestHealth.cluster.id} (${bestHealth.reputation.score}).`
            : "No cluster candidates matched the requested scope.",
        openSeats.length
            ? `Open-seat candidates: ${openSeats.map((entry) => entry.cluster.displayName ?? entry.cluster.id).join(", ")}.`
            : "No open seats found in the requested scope.",
        operator?.openSeatInterest
            ? `${operator.displayName ?? operator.id} is marked interested in open seats.`
            : operator
                ? `${operator.displayName ?? operator.id} is not marked as actively seeking open seats.`
                : "Pass operatorId to tailor onboarding and seat guidance.",
        "Keep operational changes behind explicit operator workflows; do not mix them with consumer wallet/order flows.",
    ];
}
function clusterScore(cluster) {
    const reputation = cluster.reputation?.score ?? 50;
    const uptime = cluster.reputation?.uptime30d ? Math.min(100, cluster.reputation.uptime30d) : 50;
    const diversity = cluster.diversity?.decentralizationScore ?? 50;
    const statusPenalty = cluster.status === "active" ? 0 : cluster.status === "degraded" ? 15 : 35;
    const foundationPenalty = cluster.foundationControlled ? 8 : 0;
    const slashingPenalty = (cluster.reputation?.slashingIncidents ?? 0) * 20;
    return Math.max(0, Math.round(reputation * 0.45 + uptime * 0.2 + diversity * 0.35 - statusPenalty - foundationPenalty - slashingPenalty));
}
function serviceScore(entry) {
    const uptime = entry.service.uptime30d ?? 0;
    const latencyBonus = entry.service.proofLatencyMsP50 ? Math.max(0, 20 - entry.service.proofLatencyMsP50 / 100) : 0;
    const statusBonus = entry.service.status === "active" ? 20 : 0;
    return entry.reputation.score + uptime / 5 + latencyBonus + statusBonus;
}
function same(a, b) {
    return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}
