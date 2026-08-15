import { createHash } from "node:crypto";

/** Stable, short fingerprint for PATH-like strings. Not a secret hash. */
export function fingerprintPath(pathValue: string | undefined): string | null {
  if (typeof pathValue !== "string" || pathValue.length === 0) {
    return null;
  }
  return createHash("sha256").update(pathValue).digest("hex").slice(0, 16);
}
