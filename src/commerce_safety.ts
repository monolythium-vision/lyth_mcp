export interface CommerceSafetyInput {
  query?: string;
  category?: string;
  service?: string;
  description?: string;
  vendorId?: string;
}

export interface CommerceSafetyEvaluation {
  ok: boolean;
  level: "allow" | "warn" | "block";
  violations: string[];
  warnings: string[];
  policyBasis: string[];
  clientAction: "allow" | "hide_or_refuse" | "require_human_review";
  notes: string[];
}

const BLOCKED_PATTERNS = [
  { code: "illegal_drugs", pattern: /\b(cocaine|heroin|meth|fentanyl|mdma|ecstasy|lsd|illegal\s+drug|narcotic)\b/i },
  { code: "weapons", pattern: /\b(guns?|firearms?|weapons?|explosives?|bombs?|ammo|ammunition|grenades?)\b/i },
  { code: "fraud", pattern: /\b(stolen\s+card|carding|phishing|fake\s+id|money\s+launder|laundering|scam|fraud)\b/i },
  { code: "credential_abuse", pattern: /\b(password\s+dump|credential\s+dump|account\s+takeover|session\s+cookie|steal\s+login)\b/i },
  { code: "malware", pattern: /\b(malware|ransomware|botnet|keylogger|trojan|exploit\s+kit)\b/i },
  { code: "violence", pattern: /\b(hitman|assassination|hire\s+.*killer|violent\s+attack)\b/i },
  { code: "illicit_services", pattern: /\b(illegal\s+service|black\s+market|counterfeit|forged\s+document)\b/i },
];

const RESTRICTED_PATTERNS = [
  { code: "regulated_finance", pattern: /\b(investment\s+advice|tax\s+avoidance|securities|brokerage|loan|credit)\b/i },
  { code: "legal_services", pattern: /\b(lawyer|legal|contract\s+review|privacy\s+policy|dispute)\b/i },
  { code: "medical_services", pattern: /\b(doctor|medical|prescription|diagnosis|therapy|medicine)\b/i },
  { code: "age_restricted", pattern: /\b(alcohol|tobacco|vape|gambling|casino|betting)\b/i },
  { code: "high_value_travel", pattern: /\b(passport|visa|flight|hotel|travel)\b/i },
];

const RESTRICTED_CATEGORIES = new Set([
  "professional_services",
  "legal",
  "finance",
  "medical",
  "travel",
  "gift_cards",
]);

export function evaluateCommerceSafety(input: CommerceSafetyInput): CommerceSafetyEvaluation {
  const text = [
    input.query,
    input.category,
    input.service,
    input.description,
    input.vendorId,
  ].filter(Boolean).join(" ");
  const violations = BLOCKED_PATTERNS
    .filter((entry) => entry.pattern.test(text))
    .map((entry) => `Blocked commerce policy matched: ${entry.code}.`);
  const warnings = RESTRICTED_PATTERNS
    .filter((entry) => entry.pattern.test(text))
    .map((entry) => `Restricted commerce policy matched: ${entry.code}; require human review and real provider credentials.`);
  const category = input.category?.toLowerCase();
  if (category && RESTRICTED_CATEGORIES.has(category)) {
    warnings.push(`Category ${input.category} is restricted; require human review and jurisdiction/provider checks.`);
  }
  const ok = violations.length === 0;
  return {
    ok,
    level: violations.length > 0 ? "block" : warnings.length > 0 ? "warn" : "allow",
    violations,
    warnings,
    policyBasis: [
      "Local MCP client policy may hide/refuse unsafe vendor discovery even if a listing exists on-chain.",
      "Arbiters and providers may refuse disputes or jobs that violate their own terms or local law.",
      "TODO(mainnet): replace this bundled keyword policy with signed client-policy metadata and jurisdiction-aware provider policy.",
    ],
    clientAction: violations.length > 0 ? "hide_or_refuse" : warnings.length > 0 ? "require_human_review" : "allow",
    notes: [
      "This is a client-side safety screen, not a protocol-level validity rule.",
      "The MCP should not help source illegal goods or services.",
    ],
  };
}

export function commerceSafetySummary(input: CommerceSafetyInput) {
  const evaluation = evaluateCommerceSafety(input);
  return {
    input,
    ...evaluation,
    summary: evaluation.ok
      ? evaluation.level === "warn"
        ? "Request is not blocked, but it is restricted and should require human review."
        : "Request passed local commerce safety policy."
      : "Request is blocked by local commerce safety policy.",
  };
}
