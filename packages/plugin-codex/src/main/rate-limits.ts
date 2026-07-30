import type {
  AccountUsageMetric,
  AccountUsageQuotaMetric,
} from "@pier/plugin-api/account-usage";
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
  bucket: { groupId: string; name?: string },
  position: "primary" | "secondary"
): AccountUsageQuotaMetric | undefined {
  if (
    !raw ||
    typeof raw.usedPercent !== "number" ||
    !Number.isFinite(raw.usedPercent)
  ) {
    return;
  }
  const result: AccountUsageQuotaMetric = {
    groupId: bucket.groupId,
    id: `${bucket.groupId}:${position}`,
    kind: "quota",
    usedPercent: raw.usedPercent,
    ...(bucket.name ? { name: bucket.name } : {}),
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
): AccountUsageQuotaMetric[] {
  const limitId =
    typeof raw.limitId === "string" && raw.limitId.length > 0
      ? raw.limitId
      : fallbackLimitId;
  const limitName =
    typeof raw.limitName === "string" && raw.limitName.length > 0
      ? raw.limitName
      : undefined;
  const bucket = {
    groupId: limitId,
    ...(limitName ? { name: limitName } : {}),
  };
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
    return { status: "error", error: "Empty RPC result", metrics: [] };
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
      metrics: [],
    };
  }
  const rl = hasCompatibilityBucket
    ? (rateLimits as Record<string, unknown>)
    : {};
  const out: AccountUsageResult = { status: "ok", metrics: [] };
  const planTypeCandidate = rl.planType ?? obj.planType;
  if (typeof planTypeCandidate === "string" && planTypeCandidate.length > 0) {
    out.planType = planTypeCandidate;
  }
  let resetCreditsMetric: AccountUsageMetric | undefined;
  const resetCredits = rl.rateLimitResetCredits ?? obj.rateLimitResetCredits;
  if (resetCredits && typeof resetCredits === "object") {
    const available = (resetCredits as Record<string, unknown>).availableCount;
    // 0 表示没有可用重置次数：不进指标列表，避免 UI 展示「额度重置次数 0」
    if (
      typeof available === "number" &&
      Number.isInteger(available) &&
      available > 0
    ) {
      resetCreditsMetric = {
        format: "count",
        id: "codex:reset-credits",
        kind: "scalar",
        value: available,
      };
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
        out.metrics.push(
          ...mapRateLimitBucket(bucket as RpcRateLimitBucket, limitId)
        );
      }
    }
  }
  if (hasCompatibilityBucket) {
    const compatibilityWindows = mapRateLimitBucket(
      rl as RpcRateLimitBucket,
      "codex"
    );
    const quotaMetrics = out.metrics.filter(
      (metric): metric is AccountUsageQuotaMetric => metric.kind === "quota"
    );
    if (quotaMetrics.length === 0) {
      out.metrics.push(...compatibilityWindows);
    } else if (compatibilityWindows.length > 0) {
      const existingIds = new Set(quotaMetrics.map((window) => window.id));
      const missingCompatibilityWindows = compatibilityWindows.filter(
        (window) => !existingIds.has(window.id)
      );
      if (missingCompatibilityWindows.length > 0) {
        const compatibilityGroupId = compatibilityWindows[0]?.groupId;
        const scalarMetrics = out.metrics.filter(
          (metric) => metric.kind === "scalar"
        );
        const sameBucket = quotaMetrics
          .filter((window) => window.groupId === compatibilityGroupId)
          .concat(missingCompatibilityWindows)
          .sort(
            (left, right) =>
              (left.windowMinutes ?? Number.POSITIVE_INFINITY) -
              (right.windowMinutes ?? Number.POSITIVE_INFINITY)
          );
        out.metrics = [
          ...sameBucket,
          ...quotaMetrics.filter(
            (window) => window.groupId !== compatibilityGroupId
          ),
          ...scalarMetrics,
        ];
      }
    }
  }
  if (!out.metrics.some((metric) => metric.kind === "quota")) {
    return {
      status: "error",
      error: "No supported quota metrics in RPC result",
      metrics: [],
      ...(out.planType ? { planType: out.planType } : {}),
    };
  }
  if (resetCreditsMetric) {
    out.metrics.push(resetCreditsMetric);
  }
  return out;
}
