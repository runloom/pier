const MAX_CTX_KEYS = 24;
const MAX_CTX_STRING_LENGTH = 200;
const MAX_CTX_DEPTH = 2;
const MAX_CTX_ARRAY_LENGTH = 16;

/**
 * Bound diagnostic ctx so a busy renderer path cannot flood JSONL with
 * large nested snapshots (mirrors the strict input-routing diagnostic caps).
 */
export function sanitizeTaskRuntimeDiagnosticCtx(
  ctx: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!ctx) {
    return;
  }
  const keys = Object.keys(ctx).slice(0, MAX_CTX_KEYS);
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const clippedKey =
      key.length > MAX_CTX_STRING_LENGTH
        ? key.slice(0, MAX_CTX_STRING_LENGTH)
        : key;
    const sanitized = sanitizeDiagnosticValue(ctx[key], 0);
    if (sanitized !== undefined) {
      out[clippedKey] = sanitized;
    }
  }
  return out;
}

function sanitizeDiagnosticValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "string") {
    return value.length > MAX_CTX_STRING_LENGTH
      ? value.slice(0, MAX_CTX_STRING_LENGTH)
      : value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (depth >= MAX_CTX_DEPTH) {
    if (Array.isArray(value)) {
      return `[array:${value.length}]`;
    }
    if (value && typeof value === "object") {
      return `[object:${Object.keys(value).length}]`;
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_CTX_ARRAY_LENGTH)
      .map((item) => sanitizeDiagnosticValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(
      0,
      MAX_CTX_KEYS
    );
    const nested: Record<string, unknown> = {};
    for (const [key, nestedValue] of entries) {
      const clippedKey =
        key.length > MAX_CTX_STRING_LENGTH
          ? key.slice(0, MAX_CTX_STRING_LENGTH)
          : key;
      const sanitized = sanitizeDiagnosticValue(nestedValue, depth + 1);
      if (sanitized !== undefined) {
        nested[clippedKey] = sanitized;
      }
    }
    return nested;
  }
  // functions / symbols / undefined
  return;
}
