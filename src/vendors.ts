import { createHash, verify as verifySignature } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { canonicalize } from "./runbooks.js";

export interface VendorRegistrySignature {
  algorithm?: string;
  publicKeyPem?: string;
  signatureBase64?: string;
}

export interface VendorRegistry {
  schemaVersion?: number;
  network?: string;
  issuer?: string;
  expiresAt?: string;
  disclaimer?: string;
  signature?: VendorRegistrySignature;
  signatures?: VendorRegistrySignature[];
  vendors: VendorRecord[];
  [key: string]: unknown;
}

export interface VendorRecord {
  id: string;
  displayName?: string;
  category?: string;
  address?: string;
  acceptedAssets?: string[];
  maxOrderAmount?: string;
  serviceTags?: string[];
  fulfillment?: {
    type?: string;
    etaMinutes?: number;
    requiredFields?: string[];
    [key: string]: unknown;
  };
  catalog?: VendorCatalogItem[];
  [key: string]: unknown;
}

export interface VendorCatalogItem {
  id: string;
  name?: string;
  description?: string;
  price?: string;
  asset?: string;
  [key: string]: unknown;
}

export interface LoadedVendorRegistry {
  source: string;
  registry: VendorRegistry;
  contentHash: string;
  payloadHash: string;
  bytes: number;
  updatedAt?: string;
  signatureStatus: {
    status: "unsigned" | "verified" | "invalid" | "present_unverified";
    reason: string;
    expired: boolean;
    expiresAt?: string;
  };
}

export interface VendorQuote {
  vendorId: string;
  vendorDisplayName?: string;
  vendorAddress?: string;
  itemId?: string;
  itemName?: string;
  quantity: number;
  amount: string;
  asset: string;
  fulfillmentType?: string;
  requiredFulfillmentFields: string[];
  missingFulfillmentFields: string[];
  warnings: string[];
  registryHash: string;
}

export async function loadVendorRegistry(path: string): Promise<LoadedVendorRegistry> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as VendorRegistry | VendorRecord[];
  const registry: VendorRegistry = Array.isArray(parsed)
    ? { vendors: parsed }
    : parsed;
  if (!Array.isArray(registry.vendors)) {
    throw new Error("vendor registry must be an array or an object with a vendors array");
  }
  const stats = await stat(path);
  const canonicalContent = canonicalize(registry);
  const payload = registryPayload(registry);
  const canonicalPayload = canonicalize(payload);
  return {
    source: path,
    registry,
    contentHash: `sha256:${createHash("sha256").update(canonicalContent).digest("hex")}`,
    payloadHash: `sha256:${createHash("sha256").update(canonicalPayload).digest("hex")}`,
    bytes: Buffer.byteLength(raw),
    updatedAt: stats.mtime.toISOString(),
    signatureStatus: verifyRegistrySignature(registry, canonicalPayload),
  };
}

export function vendorRegistrySummary(loaded: LoadedVendorRegistry) {
  const categories = [...new Set(loaded.registry.vendors.map((vendor) => vendor.category).filter(Boolean))].sort();
  return {
    source: loaded.source,
    schemaVersion: loaded.registry.schemaVersion,
    network: loaded.registry.network,
    issuer: loaded.registry.issuer,
    expiresAt: loaded.registry.expiresAt,
    disclaimer: loaded.registry.disclaimer,
    contentHash: loaded.contentHash,
    payloadHash: loaded.payloadHash,
    bytes: loaded.bytes,
    updatedAt: loaded.updatedAt,
    signatureStatus: loaded.signatureStatus,
    vendorCount: loaded.registry.vendors.length,
    categories,
  };
}

export function searchVendors(registry: VendorRegistry, args: {
  query?: string;
  category?: string;
  limit?: number;
} = {}): VendorRecord[] {
  const q = args.query?.toLowerCase();
  const c = args.category?.toLowerCase();
  return registry.vendors
    .filter((vendor) => {
      const haystack = canonicalize(vendor).toLowerCase();
      return (!q || haystack.includes(q)) && (!c || String(vendor.category ?? "").toLowerCase() === c);
    })
    .slice(0, args.limit ?? 10);
}

export function getVendor(registry: VendorRegistry, vendorId: string): VendorRecord {
  const vendor = registry.vendors.find((item) => item.id === vendorId);
  if (!vendor) {
    throw new Error(`vendor '${vendorId}' not found`);
  }
  return vendor;
}

export function quoteVendorOrder(args: {
  registryHash: string;
  vendor: VendorRecord;
  itemId?: string;
  quantity?: number;
  asset?: string;
  fulfillmentFields?: Record<string, unknown>;
}): VendorQuote {
  const quantity = args.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("quantity must be a positive integer");
  }
  const item = args.itemId
    ? args.vendor.catalog?.find((entry) => entry.id === args.itemId)
    : args.vendor.catalog?.[0];
  if (args.itemId && !item) {
    throw new Error(`catalog item '${args.itemId}' not found for vendor '${args.vendor.id}'`);
  }
  const asset = String(args.asset ?? item?.asset ?? args.vendor.acceptedAssets?.[0] ?? "LYTH").toUpperCase();
  const warnings: string[] = [];
  if (args.vendor.acceptedAssets && !args.vendor.acceptedAssets.map((value) => value.toUpperCase()).includes(asset)) {
    warnings.push(`Vendor does not list ${asset} as an accepted asset.`);
  }
  const unitPrice = item?.price ?? "0";
  const amount = multiplyDecimal(unitPrice, quantity);
  if (args.vendor.maxOrderAmount && compareDecimal(amount, args.vendor.maxOrderAmount) > 0) {
    warnings.push(`Quote amount ${amount} exceeds vendor maxOrderAmount ${args.vendor.maxOrderAmount}.`);
  }
  const requiredFulfillmentFields = args.vendor.fulfillment?.requiredFields ?? [];
  const fulfillmentFields = args.fulfillmentFields ?? {};
  const missingFulfillmentFields = requiredFulfillmentFields.filter((field) => {
    const value = fulfillmentFields[field];
    return value === undefined || value === null || value === "";
  });
  if (missingFulfillmentFields.length > 0) {
    warnings.push(`Missing fulfillment fields: ${missingFulfillmentFields.join(", ")}.`);
  }
  if (args.vendor.fulfillment?.type?.includes("demo")) {
    warnings.push("Vendor fulfillment is demo-only; no real goods or services will be delivered.");
  }
  return {
    vendorId: args.vendor.id,
    vendorDisplayName: args.vendor.displayName,
    vendorAddress: args.vendor.address,
    itemId: item?.id,
    itemName: item?.name,
    quantity,
    amount,
    asset,
    fulfillmentType: args.vendor.fulfillment?.type,
    requiredFulfillmentFields,
    missingFulfillmentFields,
    warnings,
    registryHash: args.registryHash,
  };
}

function verifyRegistrySignature(registry: VendorRegistry, canonicalPayload: string): LoadedVendorRegistry["signatureStatus"] {
  const expired = Boolean(registry.expiresAt && Date.parse(registry.expiresAt) <= Date.now());
  const signature = registry.signature ?? registry.signatures?.[0];
  if (!signature) {
    return {
      status: "unsigned",
      reason: "Registry has no signature metadata.",
      expired,
      expiresAt: registry.expiresAt,
    };
  }
  if (signature.algorithm !== "ed25519" || !signature.publicKeyPem || !signature.signatureBase64) {
    return {
      status: "present_unverified",
      reason: "Signature metadata is present but unsupported or incomplete. Supported format: ed25519 + publicKeyPem + signatureBase64.",
      expired,
      expiresAt: registry.expiresAt,
    };
  }
  try {
    const ok = verifySignature(null, Buffer.from(canonicalPayload), signature.publicKeyPem, Buffer.from(signature.signatureBase64, "base64"));
    return {
      status: ok ? "verified" : "invalid",
      reason: ok ? "Registry signature verified." : "Registry signature did not verify.",
      expired,
      expiresAt: registry.expiresAt,
    };
  } catch (err) {
    return {
      status: "invalid",
      reason: err instanceof Error ? err.message : String(err),
      expired,
      expiresAt: registry.expiresAt,
    };
  }
}

function registryPayload(registry: VendorRegistry): VendorRegistry {
  const { signature: _signature, signatures: _signatures, ...payload } = registry;
  return payload as VendorRegistry;
}

function multiplyDecimal(value: string, multiplier: number): string {
  return unitsToDecimal(decimalToUnits(value) * BigInt(multiplier));
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

function unitsToDecimal(value: bigint, decimals = 18): string {
  const sign = value < 0n ? "-" : "";
  const raw = (value < 0n ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = raw.slice(0, -decimals);
  const frac = raw.slice(-decimals).replace(/0+$/, "");
  return `${sign}${whole}${frac ? `.${frac}` : ""}`;
}
