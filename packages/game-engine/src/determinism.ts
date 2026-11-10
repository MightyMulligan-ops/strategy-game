import { createHash } from "node:crypto";

export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Call only with schema-validated JSON values. Key insertion order must not
// alter audit IDs; array order remains meaningful (especially movement queues).
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Expected a validated JSON value");
  return encoded;
}

export function auditHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
