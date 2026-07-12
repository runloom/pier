import type { AccountUsageResult } from "./types.ts";

interface RpcWindow {
  resetsAt?: number;
  usedPercent?: number;
  windowDurationMins?: number;
}

interface RpcRateLimitBucket {
  limitId?: unknown;
  limitName?: unknown;
  primary?: RpcWindow | null;
  secondary?: RpcWindow | null;
}

function mapRpcWindow(
  raw: RpcWindow | null | undefined,
  bucket: { limitId: string; limitName?: string },
  position: "primary" | "secondary"
): AccountUsageResult["windows"][number] | undefined {
  if (
    !raw ||
    typeof raw.usedPercent !== "number" ||
    !Number.isFinite(raw.usedPercent)
  ) {
    return;
  }
  const result: AccountUsageResult["windows"][number] = {
    id: `${bucket.limitId}:${position}`,
    limitId: bucket.limitId,
    usedPercent: raw.usedPercent,
    ...(bucket.limitName ? { limitName: bucket.limitName } : {}),
  };
  if (typeof raw.resetsAt === "number" && Number.isFinite(raw.resetsAt)) {
    result.resetsAt = raw.resetsAt * 1000;
  }
  if (
    typeof raw.windowDurationMins === "number" &&
    Number.isFinite(raw.windowDurationMins) &&
    raw.windowDurationMins > 0
  ) {
    result.windowMinutes = raw.windowDurationMins;
  }
  return result;
}

function mapRateLimitBucket(
  raw: RpcRateLimitBucket,
  fallbackLimitId: string
): AccountUsageResult["windows"] {
  const limitId =
    typeof raw.limitId === "string" && raw.limitId.length > 0
      ? raw.limitId
      : fallbackLimitId;
  const limitName =
    typeof raw.limitName === "string" && raw.limitName.length > 0
      ? raw.limitName
      : undefined;
  const bucket = { limitId, ...(limitName ? { limitName } : {}) };
  return [
    mapRpcWindow(raw.primary, bucket, "primary"),
    mapRpcWindow(raw.secondary, bucket, "secondary"),
  ]
    .filter((window) => window !== undefined)
    .sort(
      (left, right) =>
        (left.windowMinutes ?? Number.POSITIVE_INFINITY) -
        (right.windowMinutes ?? Number.POSITIVE_INFINITY)
    );
}

function bucketLimitId(key: string, bucket: Record<string, unknown>): string {
  return typeof bucket.limitId === "string" && bucket.limitId.length > 0
    ? bucket.limitId
    : key;
}

/** 将 App Server 单桶或多桶响应标准化为动态额度窗口。 */
export function parseRateLimitsResult(result: unknown): AccountUsageResult {
  if (result === null || result === undefined || typeof result !== "object") {
    return { status: "error", error: "Empty RPC result", windows: [] };
  }
  const obj = result as Record<string, unknown>;
  const rateLimits = obj.rateLimits;
  const rateLimitsByLimitId = obj.rateLimitsByLimitId;
  const hasCompatibilityBucket = Boolean(
    rateLimits && typeof rateLimits === "object"
  );
  const hasMultiBucketView = Boolean(
    rateLimitsByLimitId && typeof rateLimitsByLimitId === "object"
  );
  if (!(hasCompatibilityBucket || hasMultiBucketView)) {
    return {
      status: "error",
      error: "Missing rate limit buckets in RPC result",
      windows: [],
    };
  }
  const rl = hasCompatibilityBucket
    ? (rateLimits as Record<string, unknown>)
    : {};
  const out: AccountUsageResult = { status: "ok", windows: [] };
  const resetCredits = rl.rateLimitResetCredits ?? obj.rateLimitResetCredits;
  if (resetCredits && typeof resetCredits === "object") {
    const available = (resetCredits as Record<string, unknown>).availableCount;
    if (
      typeof available === "number" &&
      Number.isInteger(available) &&
      available >= 0
    ) {
      out.resetCreditsAvailable = available;
    }
  }
  if (hasMultiBucketView) {
    const preferredLimitId =
      typeof rl.limitId === "string" && rl.limitId.length > 0
        ? rl.limitId
        : "codex";
    const buckets = Object.entries(
      rateLimitsByLimitId as Record<string, unknown>
    ).sort(([leftKey, left], [rightKey, right]) => {
      const leftIsPreferred =
        left !== null &&
        typeof left === "object" &&
        bucketLimitId(leftKey, left as Record<string, unknown>) ===
          preferredLimitId;
      const rightIsPreferred =
        right !== null &&
        typeof right === "object" &&
        bucketLimitId(rightKey, right as Record<string, unknown>) ===
          preferredLimitId;
      return Number(rightIsPreferred) - Number(leftIsPreferred);
    });
    for (const [limitId, bucket] of buckets) {
      if (bucket && typeof bucket === "object") {
        out.windows.push(
          ...mapRateLimitBucket(bucket as RpcRateLimitBucket, limitId)
        );
      }
    }
  }
  if (out.windows.length === 0 && hasCompatibilityBucket) {
    out.windows = mapRateLimitBucket(rl as RpcRateLimitBucket, "codex");
  }
  return out;
}
