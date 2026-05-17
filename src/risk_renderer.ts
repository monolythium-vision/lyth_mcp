export interface RiskRenderInput {
  title?: string;
  operation?: string;
  amount?: string;
  asset?: string;
  counterparty?: string;
  merchantRisk?: unknown;
  assetPolicy?: unknown;
  bridgeQuote?: unknown;
  commerceSafety?: unknown;
  preflight?: unknown;
  receiptPath?: string;
  retryPath?: string;
}

export interface RiskRenderOutput {
  ok: boolean;
  level: "low" | "medium" | "high" | "blocked";
  markdown: string;
  violations: string[];
  warnings: string[];
  assumptions: string[];
  retryPath?: string;
  receiptPath?: string;
}

export function renderRisk(input: RiskRenderInput): RiskRenderOutput {
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
  ].filter((line): line is string => line !== null).join("\n");
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

function riskLevel(input: RiskRenderInput, violations: string[], warnings: string[]): RiskRenderOutput["level"] {
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

function booleansOk(input: RiskRenderInput): boolean {
  return [input.merchantRisk, input.assetPolicy, input.bridgeQuote, input.commerceSafety, input.preflight]
    .filter(Boolean)
    .every((value) => {
      if (typeof value !== "object" || value === null || !("ok" in value)) {
        if (typeof value === "object" && value !== null && "executable" in value) {
          return Boolean((value as { executable?: unknown }).executable);
        }
        return true;
      }
      return Boolean((value as { ok?: unknown }).ok);
    });
}

function hasBlockedLevel(input: RiskRenderInput): boolean {
  return [input.merchantRisk, input.assetPolicy, input.bridgeQuote, input.commerceSafety, input.preflight]
    .some((value) => hasLevelInValue(value, "blocked") || hasLevelInValue(value, "block"));
}

function hasLevel(input: RiskRenderInput, level: string): boolean {
  return [input.merchantRisk, input.assetPolicy, input.bridgeQuote, input.commerceSafety, input.preflight]
    .some((value) => hasLevelInValue(value, level));
}

function hasFalseExecutable(input: RiskRenderInput): boolean {
  return [input.merchantRisk, input.assetPolicy, input.bridgeQuote, input.commerceSafety, input.preflight]
    .some((value) => Boolean(value && typeof value === "object" && "executable" in value && !(value as { executable?: unknown }).executable));
}

function hasLevelInValue(value: unknown, level: string): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.level === level || record.riskLevel === level) {
    return true;
  }
  if (record.risk && typeof record.risk === "object") {
    return (record.risk as Record<string, unknown>).level === level;
  }
  return false;
}

function stringsAt(value: unknown, key: string): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const raw = (value as Record<string, unknown>)[key];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}
