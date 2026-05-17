export function renderRisk(input) {
    const violations = [
        ...stringsAt(input.merchantRisk, "violations"),
        ...stringsAt(input.assetPolicy, "violations"),
        ...stringsAt(input.bridgeQuote, "violations"),
        ...stringsAt(input.commerceSafety, "violations"),
        ...stringsAt(input.preflight, "violations"),
    ];
    const warnings = [
        ...stringsAt(input.merchantRisk, "warnings"),
        ...stringsAt(input.assetPolicy, "warnings"),
        ...stringsAt(input.bridgeQuote, "warnings"),
        ...stringsAt(input.commerceSafety, "warnings"),
        ...stringsAt(input.preflight, "warnings"),
    ];
    const assumptions = [
        ...stringsAt(input.merchantRisk, "notes"),
        ...stringsAt(input.assetPolicy, "warnings"),
        ...stringsAt(input.bridgeQuote, "warnings"),
        ...stringsAt(input.commerceSafety, "policyBasis"),
        "TODO(mainnet): replace local/draft metadata with signed on-chain/indexer metadata wherever available.",
    ];
    const ok = violations.length === 0 && booleansOk(input);
    const level = riskLevel(input, violations, warnings);
    const markdown = [
        `# ${input.title ?? "Risk Summary"}`,
        "",
        `Operation: ${input.operation ?? "unspecified"}`,
        input.amount || input.asset ? `Amount: ${[input.amount, input.asset].filter(Boolean).join(" ")}` : null,
        input.counterparty ? `Counterparty: ${input.counterparty}` : null,
        `Decision: ${ok ? "allowed" : "blocked"}`,
        `Risk level: ${level}`,
        "",
        "## Violations",
        violations.length ? violations.map((item) => `- ${item}`).join("\n") : "- None",
        "",
        "## Warnings",
        warnings.length ? warnings.map((item) => `- ${item}`).join("\n") : "- None",
        "",
        "## Assumptions",
        assumptions.length ? [...new Set(assumptions)].map((item) => `- ${item}`).join("\n") : "- None",
        "",
        "## Next Steps",
        ok
            ? [
                "- Show the user the exact action before signing.",
                input.receiptPath ? `- Receipt path: ${input.receiptPath}` : "- Record an MCP receipt after drafting/signing/submitting.",
                input.retryPath ? `- Retry path: ${input.retryPath}` : "- If broadcast fails, retry the stored outbox payload instead of rebuilding.",
            ].join("\n")
            : "- Do not sign or submit. Resolve the listed violations first.",
    ].filter((line) => line !== null).join("\n");
    return {
        ok,
        level,
        markdown,
        violations,
        warnings,
        assumptions: [...new Set(assumptions)],
        retryPath: input.retryPath,
        receiptPath: input.receiptPath,
    };
}
function riskLevel(input, violations, warnings) {
    if (violations.length > 0 || hasBlockedLevel(input) || hasFalseExecutable(input)) {
        return "blocked";
    }
    if (hasLevel(input, "high")) {
        return "high";
    }
    if (warnings.length > 0 || hasLevel(input, "medium") || hasLevel(input, "unknown")) {
        return "medium";
    }
    return "low";
}
function booleansOk(input) {
    return [input.merchantRisk, input.assetPolicy, input.bridgeQuote, input.commerceSafety, input.preflight]
        .filter(Boolean)
        .every((value) => {
        if (typeof value !== "object" || value === null || !("ok" in value)) {
            if (typeof value === "object" && value !== null && "executable" in value) {
                return Boolean(value.executable);
            }
            return true;
        }
        return Boolean(value.ok);
    });
}
function hasBlockedLevel(input) {
    return [input.merchantRisk, input.assetPolicy, input.bridgeQuote, input.commerceSafety, input.preflight]
        .some((value) => hasLevelInValue(value, "blocked") || hasLevelInValue(value, "block"));
}
function hasLevel(input, level) {
    return [input.merchantRisk, input.assetPolicy, input.bridgeQuote, input.commerceSafety, input.preflight]
        .some((value) => hasLevelInValue(value, level));
}
function hasFalseExecutable(input) {
    return [input.merchantRisk, input.assetPolicy, input.bridgeQuote, input.commerceSafety, input.preflight]
        .some((value) => Boolean(value && typeof value === "object" && "executable" in value && !value.executable));
}
function hasLevelInValue(value, level) {
    if (!value || typeof value !== "object") {
        return false;
    }
    const record = value;
    if (record.level === level || record.riskLevel === level) {
        return true;
    }
    if (record.risk && typeof record.risk === "object") {
        return record.risk.level === level;
    }
    return false;
}
function stringsAt(value, key) {
    if (!value || typeof value !== "object") {
        return [];
    }
    const raw = value[key];
    return Array.isArray(raw) ? raw.filter((item) => typeof item === "string") : [];
}
