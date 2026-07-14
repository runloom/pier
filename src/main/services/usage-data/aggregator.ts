import type {
  UsageAggregateOverall,
  UsageAggregateSnapshot,
  UsageAggregateSource,
  UsageDataDailyBucket,
  UsageDataSnapshot,
  UsageDataSummary,
  UsageTokenTotals,
} from "@shared/contracts/usage-data.ts";

/**
 * 聚合多个源快照为一份指挥中心可消费的整体快照。
 *
 * 语义：
 * - `buckets`：按 `date` 分组求和；`estimatedCostMicrousd` 全 `null` 才保持 `null`，
 *   否则相加。`pricingStatus` 根据合并后是否同时包含已定价与未定价贡献派生。
 * - `coverage.from` 取 min、`to` 取 max；`complete = all(complete)`。
 * - `summary`：从合并 buckets 派生 today/period/latest，`sourceCount = sources.length`。
 * - `observedAt`：取最大 observedAt，代表整体最近一次观察时刻。
 * - 空数组：返回“空聚合”，日历范围回落到今日、`complete = false`、`sourceCount = 0`。
 */

function emptyTotals(): UsageTokenTotals {
  return {
    cachedInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

function mergedPricingStatus(
  hasPricedCost: boolean,
  hasUnpricedCost: boolean
): UsageDataDailyBucket["pricingStatus"] {
  if (!hasUnpricedCost) return "complete";
  return hasPricedCost ? "partial" : "unpriced";
}

function mergeBuckets(
  snapshots: readonly UsageDataSnapshot[]
): UsageDataDailyBucket[] {
  const byDate = new Map<
    string,
    {
      hasUnpricedCost: boolean;
      pricedCost: number;
      hasPricedCost: boolean;
      tokens: UsageTokenTotals;
    }
  >();
  for (const snapshot of snapshots) {
    for (const bucket of snapshot.buckets) {
      const row = byDate.get(bucket.date) ?? {
        hasPricedCost: false,
        hasUnpricedCost: false,
        pricedCost: 0,
        tokens: emptyTotals(),
      };
      row.tokens.cachedInputTokens += bucket.tokens.cachedInputTokens;
      row.tokens.inputTokens += bucket.tokens.inputTokens;
      row.tokens.outputTokens += bucket.tokens.outputTokens;
      row.tokens.reasoningTokens += bucket.tokens.reasoningTokens;
      row.tokens.totalTokens += bucket.tokens.totalTokens;
      if (bucket.estimatedCostMicrousd !== null) {
        row.pricedCost += bucket.estimatedCostMicrousd;
        row.hasPricedCost = true;
      }
      if (
        bucket.estimatedCostMicrousd === null ||
        bucket.pricingStatus !== "complete"
      ) {
        row.hasUnpricedCost = true;
      }
      byDate.set(bucket.date, row);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => ({
      date,
      estimatedCostMicrousd: row.hasPricedCost ? row.pricedCost : null,
      pricingStatus: mergedPricingStatus(
        row.hasPricedCost,
        row.hasUnpricedCost
      ),
      tokens: row.tokens,
    }));
}

function overallCoverage(
  snapshots: readonly UsageDataSnapshot[]
): UsageAggregateOverall["coverage"] {
  if (snapshots.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    return { complete: false, from: today, to: today };
  }
  let from = snapshots[0]!.coverage.from;
  let to = snapshots[0]!.coverage.to;
  let complete = true;
  for (const snapshot of snapshots) {
    if (snapshot.coverage.from < from) from = snapshot.coverage.from;
    if (snapshot.coverage.to > to) to = snapshot.coverage.to;
    complete = complete && snapshot.coverage.complete;
  }
  return { complete, from, to };
}

function mergeByModel(
  snapshots: readonly UsageDataSnapshot[]
): UsageDataSummary["byModel"] {
  const acc = new Map<
    string,
    { hasPricedCost: boolean; pricedCost: number; totalTokens: number }
  >();
  for (const snapshot of snapshots) {
    for (const row of snapshot.summary.byModel) {
      const existing = acc.get(row.modelId) ?? {
        hasPricedCost: false,
        pricedCost: 0,
        totalTokens: 0,
      };
      existing.totalTokens += row.totalTokens;
      if (row.estimatedCostMicrousd !== null) {
        existing.pricedCost += row.estimatedCostMicrousd;
        existing.hasPricedCost = true;
      }
      acc.set(row.modelId, existing);
    }
  }
  return [...acc.entries()].map(([modelId, row]) => ({
    estimatedCostMicrousd: row.hasPricedCost ? row.pricedCost : null,
    modelId,
    totalTokens: row.totalTokens,
  }));
}

function overallSummary(
  buckets: readonly UsageDataDailyBucket[],
  sourceCount: number,
  snapshots: readonly UsageDataSnapshot[]
): UsageAggregateOverall["summary"] {
  let periodTokens = 0;
  let priced = 0;
  let hasPriced = false;
  for (const bucket of buckets) {
    periodTokens += bucket.tokens.totalTokens;
    if (bucket.estimatedCostMicrousd !== null) {
      priced += bucket.estimatedCostMicrousd;
      hasPriced = true;
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const todayBucket = buckets.find((b) => b.date === today);
  const latestBucket = buckets.at(-1);
  return {
    byModel: mergeByModel(snapshots),
    estimatedCostMicrousd: hasPriced ? priced : null,
    latestDayTokens: latestBucket?.tokens.totalTokens ?? 0,
    periodTokens,
    sourceCount,
    todayEstimatedCostMicrousd: todayBucket?.estimatedCostMicrousd ?? null,
  };
}

export function aggregateSnapshots(
  sources: readonly UsageAggregateSource[]
): UsageAggregateSnapshot {
  const snapshots = sources.map((source) => source.snapshot);
  const buckets = mergeBuckets(snapshots);
  const observedAt = snapshots.reduce(
    (max, snapshot) => Math.max(max, snapshot.observedAt),
    0
  );
  return {
    overall: {
      buckets,
      coverage: overallCoverage(snapshots),
      observedAt,
      summary: overallSummary(buckets, sources.length, snapshots),
    },
    sources: [...sources],
  };
}
