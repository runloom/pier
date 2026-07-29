import type { AccountUsageMetric } from "@pier/plugin-api/account-usage";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function finiteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return;
}

function parseReset(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== "string") return;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Parse task-specific Grok web limits. Unknown response fields are ignored;
 * newly added frequent/occasional buckets become metrics without renderer
 * changes as long as they expose a standard used/remaining/limit shape.
 */
export function parseGrokTaskUsage(payload: unknown): AccountUsageMetric[] {
  const root = asRecord(payload);
  const buckets =
    asRecord(root?.taskUsage) ??
    asRecord(root?.task_usage) ??
    asRecord(root?.tasks) ??
    root;
  if (!buckets) return [];

  const metrics: AccountUsageMetric[] = [];
  for (const [key, value] of Object.entries(buckets)) {
    if (!/frequent|occasional/i.test(key)) continue;
    const id = `grok:tasks:${key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const name = /frequent/i.test(key) ? "Frequent tasks" : "Occasional tasks";
    if (typeof value === "number" && Number.isFinite(value)) {
      metrics.push({ format: "count", id, kind: "scalar", name, value });
      continue;
    }
    const bucket = asRecord(value);
    if (!bucket) continue;
    const limit = finiteNumber(
      bucket.limit,
      bucket.max,
      bucket.total,
      bucket.total_count
    );
    const used = finiteNumber(bucket.used, bucket.used_count);
    const remaining = finiteNumber(bucket.remaining, bucket.remaining_count);
    const directPercent = finiteNumber(
      bucket.usedPercent,
      bucket.used_percent,
      bucket.utilization
    );
    let usedPercent = directPercent;
    if (usedPercent === undefined && limit !== undefined && limit > 0) {
      if (used !== undefined) {
        usedPercent = (used / limit) * 100;
      } else if (remaining !== undefined) {
        usedPercent = ((limit - remaining) / limit) * 100;
      }
    }
    if (usedPercent === undefined) continue;
    const resetsAt = parseReset(
      bucket.resetsAt ?? bucket.resets_at ?? bucket.resetAt ?? bucket.reset_at
    );
    metrics.push({
      groupId: id,
      id,
      kind: "quota",
      name,
      usedPercent: Math.min(100, Math.max(0, usedPercent)),
      ...(resetsAt === undefined ? {} : { resetsAt }),
    });
  }
  return metrics;
}
