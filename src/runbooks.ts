import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";

export interface CanonicalRunbook {
  id: string;
  name: string;
  version: string;
  file: string;
  schemaVersion: number;
  status?: string;
  purpose?: string;
  contentHash: string;
  hashAlgorithm: "sha256";
  bytes: number;
  updatedAt?: string;
  content: unknown;
}

export interface RunbookSummary {
  id: string;
  name: string;
  version: string;
  file: string;
  schemaVersion: number;
  status?: string;
  purpose?: string;
  contentHash: string;
  hashAlgorithm: "sha256";
  bytes: number;
  updatedAt?: string;
}

export async function listCanonicalRunbooks(dir: string): Promise<RunbookSummary[]> {
  const files = (await readdir(dir))
    .filter((file) => file.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));
  const runbooks = await Promise.all(files.map((file) => loadCanonicalRunbook(join(dir, file))));
  return runbooks.map(({ content: _content, ...summary }) => summary);
}

export async function getCanonicalRunbook(dir: string, idOrName: string): Promise<CanonicalRunbook> {
  const summaries = await listCanonicalRunbooks(dir);
  const needle = idOrName.trim().toLowerCase();
  const match = summaries.find((item) => (
    item.id.toLowerCase() === needle ||
    item.name.toLowerCase() === needle ||
    `${item.name}.${item.version}`.toLowerCase() === needle
  ));
  if (!match) {
    throw new Error(`runbook '${idOrName}' not found`);
  }
  return loadCanonicalRunbook(match.file);
}

export async function loadCanonicalRunbook(path: string): Promise<CanonicalRunbook> {
  const raw = await readFile(path, "utf8");
  const content = JSON.parse(raw) as Record<string, unknown>;
  const parsed = parseRunbookFileName(path);
  const canonical = canonicalize(content);
  const stats = await stat(path);
  return {
    id: `${String(content.name ?? parsed.name)}.${parsed.version}`,
    name: String(content.name ?? parsed.name),
    version: parsed.version,
    file: path,
    schemaVersion: Number(content.schemaVersion ?? 0),
    status: typeof content.status === "string" ? content.status : undefined,
    purpose: typeof content.purpose === "string" ? content.purpose : undefined,
    contentHash: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
    hashAlgorithm: "sha256",
    bytes: Buffer.byteLength(raw),
    updatedAt: stats.mtime.toISOString(),
    content,
  };
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  throw new Error(`unsupported value in canonical JSON: ${typeof value}`);
}

export function diffRunbookContent(left: unknown, right: unknown): Array<{ field: string; left: unknown; right: unknown }> {
  const fields = new Set([
    ...Object.keys((left ?? {}) as Record<string, unknown>),
    ...Object.keys((right ?? {}) as Record<string, unknown>),
  ]);
  return [...fields].sort().flatMap((field) => {
    const l = (left as Record<string, unknown>)[field];
    const r = (right as Record<string, unknown>)[field];
    return canonicalizeOrNull(l) === canonicalizeOrNull(r) ? [] : [{ field, left: l, right: r }];
  });
}

function canonicalizeOrNull(value: unknown): string {
  return value === undefined ? "undefined" : canonicalize(value);
}

function parseRunbookFileName(path: string): { name: string; version: string } {
  const file = basename(path).replace(/\.json$/, "");
  const match = /^(?<name>.+)\.(?<version>v\d+)$/.exec(file);
  if (!match?.groups) {
    return { name: file, version: "v0" };
  }
  return {
    name: match.groups.name,
    version: match.groups.version,
  };
}
