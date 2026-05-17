import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { VendorQuote, VendorRecord } from "./vendors.js";

const STORE_VERSION = 1;

export interface MerchantPolicy {
  vendorId: string;
  enabled: boolean;
  allowlisted?: boolean;
  denylisted?: boolean;
  maxOrderAmount?: string;
  allowedAssets?: string[];
  allowedCategories?: string[];
  jurisdictionNotes?: string;
  refundPolicy?: string;
  fulfillmentSla?: string;
  disputeProcess?: string;
  riskNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantPolicyStore {
  schemaVersion: 1;
  policies: MerchantPolicy[];
}

export interface MerchantPolicyPatch {
  vendorId: string;
  enabled?: boolean;
  allowlisted?: boolean;
  denylisted?: boolean;
  maxOrderAmount?: string;
  allowedAssets?: string[];
  allowedCategories?: string[];
  jurisdictionNotes?: string;
  refundPolicy?: string;
  fulfillmentSla?: string;
  disputeProcess?: string;
  riskNotes?: string;
}

export interface MerchantPolicyEvaluation {
  ok: boolean;
  riskLevel: "unknown" | "low" | "medium" | "high" | "blocked";
  vendorId: string;
  vendorDisplayName?: string;
  policyConfigured: boolean;
  policy?: MerchantPolicy;
  violations: string[];
  warnings: string[];
  notes: string[];
}

export function merchantPolicyStorePath(): string {
  return process.env.LYTH_MCP_MERCHANT_POLICY_STORE || join(homedir(), ".lyth_mcp", "merchant_policies.json");
}

export async function readMerchantPolicyStore(path = merchantPolicyStorePath()): Promise<MerchantPolicyStore> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as MerchantPolicyStore;
    if (parsed.schemaVersion !== STORE_VERSION || !Array.isArray(parsed.policies)) {
      throw new Error(`unsupported merchant policy store shape at ${path}`);
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: STORE_VERSION, policies: [] };
    }
    throw err;
  }
}

export async function writeMerchantPolicyStore(store: MerchantPolicyStore, path = merchantPolicyStorePath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}

export async function merchantPolicyStoreInfo(path = merchantPolicyStorePath()) {
  const store = await readMerchantPolicyStore(path);
  let mode: string | null = null;
  try {
    mode = `0${(await stat(path)).mode.toString(8).slice(-3)}`;
  } catch {
    mode = null;
  }
  return {
    path,
    policyCount: store.policies.length,
    fileMode: mode,
  };
}

export async function upsertMerchantPolicy(patch: MerchantPolicyPatch): Promise<MerchantPolicy> {
  const store = await readMerchantPolicyStore();
  const now = new Date().toISOString();
  const index = store.policies.findIndex((policy) => policy.vendorId === patch.vendorId);
  const current = index >= 0 ? store.policies[index]! : null;
  const next: MerchantPolicy = {
    vendorId: patch.vendorId,
    enabled: patch.enabled ?? current?.enabled ?? true,
    allowlisted: patch.allowlisted ?? current?.allowlisted,
    denylisted: patch.denylisted ?? current?.denylisted,
    maxOrderAmount: patch.maxOrderAmount ?? current?.maxOrderAmount,
    allowedAssets: normalizeList(patch.allowedAssets ?? current?.allowedAssets, true),
    allowedCategories: normalizeList(patch.allowedCategories ?? current?.allowedCategories, false),
    jurisdictionNotes: patch.jurisdictionNotes ?? current?.jurisdictionNotes,
    refundPolicy: patch.refundPolicy ?? current?.refundPolicy,
    fulfillmentSla: patch.fulfillmentSla ?? current?.fulfillmentSla,
    disputeProcess: patch.disputeProcess ?? current?.disputeProcess,
    riskNotes: patch.riskNotes ?? current?.riskNotes,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  if (index >= 0) {
    store.policies[index] = next;
  } else {
    store.policies.unshift(next);
  }
  await writeMerchantPolicyStore(store);
  return next;
}

export async function getMerchantPolicy(vendorId: string): Promise<MerchantPolicy | null> {
  return (await readMerchantPolicyStore()).policies.find((policy) => policy.vendorId === vendorId) ?? null;
}

export async function listMerchantPolicies(args: { vendorId?: string; onlyBlocked?: boolean; limit?: number } = {}): Promise<MerchantPolicy[]> {
  return (await readMerchantPolicyStore()).policies
    .filter((policy) => !args.vendorId || policy.vendorId === args.vendorId)
    .filter((policy) => !args.onlyBlocked || policy.denylisted === true)
    .slice(0, args.limit ?? 100);
}

export async function removeMerchantPolicy(vendorId: string): Promise<{ removed: boolean; vendorId: string }> {
  const store = await readMerchantPolicyStore();
  const before = store.policies.length;
  store.policies = store.policies.filter((policy) => policy.vendorId !== vendorId);
  if (store.policies.length !== before) {
    await writeMerchantPolicyStore(store);
  }
  return { removed: store.policies.length !== before, vendorId };
}

export function evaluateMerchantPolicy(args: {
  vendor: VendorRecord;
  quote?: VendorQuote;
  policy?: MerchantPolicy | null;
  amount?: string;
  asset?: string;
}): MerchantPolicyEvaluation {
  const policy = args.policy ?? null;
  const amount = args.amount ?? args.quote?.amount;
  const asset = (args.asset ?? args.quote?.asset)?.toUpperCase();
  const category = args.vendor.category;
  const violations: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];

  if (!policy) {
    warnings.push("No merchant policy is configured for this vendor.");
    if (args.vendor.fulfillment?.type?.includes("demo")) {
      warnings.push("Vendor fulfillment is demo-only; no real goods or services will be delivered.");
    }
    return {
      ok: true,
      riskLevel: "unknown",
      vendorId: args.vendor.id,
      vendorDisplayName: args.vendor.displayName,
      policyConfigured: false,
      violations,
      warnings,
      notes,
    };
  }

  if (!policy.enabled) {
    warnings.push("Merchant policy exists but is disabled, so it is not enforcing caps or allow/deny rules.");
  } else {
    if (policy.denylisted) {
      violations.push("Vendor is denylisted by local merchant policy.");
    }
    if (amount && policy.maxOrderAmount && compareDecimal(amount, policy.maxOrderAmount) > 0) {
      violations.push(`Amount ${amount} exceeds merchant policy maxOrderAmount ${policy.maxOrderAmount}.`);
    }
    if (asset && policy.allowedAssets?.length && !policy.allowedAssets.map((value) => value.toUpperCase()).includes(asset)) {
      violations.push(`Asset ${asset} is not allowed by merchant policy.`);
    }
    if (!category && policy.allowedCategories?.length) {
      violations.push("Vendor has no category, but merchant policy requires an allowed category match.");
    }
    if (category && policy.allowedCategories?.length) {
      const allowed = policy.allowedCategories.map((value) => value.toLowerCase());
      if (!allowed.includes(category.toLowerCase())) {
        violations.push(`Vendor category ${category} is not allowed by merchant policy.`);
      }
    }
  }

  if (policy.allowlisted) {
    notes.push("Vendor is allowlisted by local merchant policy.");
  } else {
    warnings.push("Vendor is not explicitly allowlisted.");
  }
  if (policy.jurisdictionNotes) {
    notes.push(`Jurisdiction: ${policy.jurisdictionNotes}`);
  }
  if (policy.refundPolicy) {
    notes.push(`Refund policy: ${policy.refundPolicy}`);
  }
  if (policy.fulfillmentSla) {
    notes.push(`Fulfillment SLA: ${policy.fulfillmentSla}`);
  }
  if (policy.disputeProcess) {
    notes.push(`Dispute process: ${policy.disputeProcess}`);
  }
  if (policy.riskNotes) {
    notes.push(`Risk notes: ${policy.riskNotes}`);
  }
  if (args.vendor.fulfillment?.type?.includes("demo")) {
    warnings.push("Vendor fulfillment is demo-only; no real goods or services will be delivered.");
  }

  return {
    ok: violations.length === 0,
    riskLevel: riskLevel({ policy, violations, warnings }),
    vendorId: args.vendor.id,
    vendorDisplayName: args.vendor.displayName,
    policyConfigured: true,
    policy,
    violations,
    warnings,
    notes,
  };
}

function riskLevel(args: { policy: MerchantPolicy; violations: string[]; warnings: string[] }): MerchantPolicyEvaluation["riskLevel"] {
  if (args.violations.length > 0) {
    return "blocked";
  }
  if (args.policy.allowlisted && args.warnings.length === 0) {
    return "low";
  }
  if (args.policy.allowlisted) {
    return "medium";
  }
  return "high";
}

function normalizeList(values: string[] | undefined, uppercase: boolean): string[] | undefined {
  if (!values) {
    return undefined;
  }
  const normalized = values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => uppercase ? value.toUpperCase() : value);
  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function compareDecimal(a: string, b: string): number {
  const aa = decimalToUnits(a);
  const bb = decimalToUnits(b);
  return aa === bb ? 0 : aa > bb ? 1 : -1;
}

function decimalToUnits(input: string, decimals = 18): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`invalid decimal amount: ${input}`);
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) {
    throw new Error(`too many decimal places for ${decimals}-decimal asset`);
  }
  return BigInt(whole + frac.padEnd(decimals, "0"));
}
