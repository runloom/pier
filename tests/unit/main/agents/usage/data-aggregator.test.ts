import { aggregateSnapshots } from "@main/services/usage-data/aggregator.ts";
import type {
  UsageAggregateSource,
  UsageDataCoverage,
  UsageDataDailyBucket,
  UsageDataPricingStatus,
  UsageDataSnapshot,
  UsageDataSummary,
  UsageTokenTotals,
} from "@shared/contracts/usage-data.ts";
import { describe, expect, it } from "vitest";

function simpleTokens(count: number): UsageTokenTotals {
  return {
    cachedInputTokens: 0,
    inputTokens: count,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: count,
  };
}

function bucket(
  date: string,
  tokens: number,
  cost: number | null,
  status: UsageDataPricingStatus = "complete"
): UsageDataDailyBucket {
  return {
    date,
    estimatedCostMicrousd: cost,
    pricingStatus: status,
    tokens: simpleTokens(tokens),
  };
}

function oneDay(date: string): UsageDataCoverage {
  return { complete: true, from: date, to: date };
}

function snapshot(
  patch: Partial<UsageDataSnapshot> & {
    buckets: UsageDataDailyBucket[];
    coverage: UsageDataCoverage;
  }
): UsageDataSnapshot {
  const priced = patch.buckets.reduce(
    (sum, b) =>
      b.estimatedCostMicrousd === null ? sum : sum + b.estimatedCostMicrousd,
    0
  );
  const hasPriced = patch.buckets.some((b) => b.estimatedCostMicrousd !== null);
  const today = new Date().toISOString().slice(0, 10);
  const todayBucket = patch.buckets.find((b) => b.date === today);
  const latest = patch.buckets.at(-1);
  const defaultSummary: UsageDataSummary = {
    byModel: [],
    estimatedCostMicrousd: hasPriced ? priced : null,
    latestDayTokens: latest?.tokens.totalTokens ?? 0,
    periodTokens: patch.buckets.reduce(
      (sum, b) => sum + b.tokens.totalTokens,
      0
    ),
    todayEstimatedCostMicrousd: todayBucket?.estimatedCostMicrousd ?? null,
  };
  return {
    buckets: patch.buckets,
    coverage: patch.coverage,
    observedAt: patch.observedAt ?? 1,
    pluginId: patch.pluginId ?? "pier.codex",
    scope: patch.scope ?? { kind: "machine" },
    sourceId: patch.sourceId ?? "local-sessions",
    summary: patch.summary ?? defaultSummary,
  };
}

function sourceOf(snap: UsageDataSnapshot): UsageAggregateSource {
  return {
    pluginId: snap.pluginId,
    scope: snap.scope,
    snapshot: snap,
    sourceId: snap.sourceId,
  };
}

describe("aggregateSnapshots", () => {
  it("returns an empty aggregate for zero sources", () => {
    const result = aggregateSnapshots([]);
    expect(result.sources).toEqual([]);
    expect(result.overall.buckets).toEqual([]);
    expect(result.overall.summary.sourceCount).toBe(0);
    expect(result.overall.summary.estimatedCostMicrousd).toBeNull();
    expect(result.overall.summary.periodTokens).toBe(0);
    expect(result.overall.summary.byModel).toEqual([]);
    expect(result.overall.coverage.complete).toBe(false);
    expect(result.overall.observedAt).toBe(0);
  });

  it("passes a single source through as the overall", () => {
    const snap = snapshot({
      buckets: [
        bucket("2026-07-10", 100, 500),
        bucket("2026-07-11", 200, 1000),
      ],
      coverage: { complete: true, from: "2026-07-10", to: "2026-07-11" },
      observedAt: 42,
    });
    const result = aggregateSnapshots([sourceOf(snap)]);
    expect(result.overall.buckets).toHaveLength(2);
    expect(result.overall.summary.sourceCount).toBe(1);
    expect(result.overall.summary.estimatedCostMicrousd).toBe(1500);
    expect(result.overall.summary.periodTokens).toBe(300);
    expect(result.overall.coverage).toEqual({
      complete: true,
      from: "2026-07-10",
      to: "2026-07-11",
    });
    expect(result.overall.observedAt).toBe(42);
  });

  it("sums two sources that overlap on the same day", () => {
    const codex = snapshot({
      buckets: [bucket("2026-07-11", 100, 500)],
      coverage: oneDay("2026-07-11"),
      observedAt: 100,
      pluginId: "pier.codex",
    });
    const claude = snapshot({
      buckets: [bucket("2026-07-11", 300, 2000)],
      coverage: oneDay("2026-07-11"),
      observedAt: 200,
      pluginId: "pier.claude",
    });
    const result = aggregateSnapshots([sourceOf(codex), sourceOf(claude)]);
    expect(result.overall.buckets).toHaveLength(1);
    expect(result.overall.buckets[0]!.tokens.totalTokens).toBe(400);
    expect(result.overall.buckets[0]!.estimatedCostMicrousd).toBe(2500);
    expect(result.overall.summary.sourceCount).toBe(2);
    expect(result.overall.summary.periodTokens).toBe(400);
    expect(result.overall.observedAt).toBe(200);
  });

  it("unions coverage ranges from disjoint sources", () => {
    const a = snapshot({
      buckets: [bucket("2026-06-01", 50, 100)],
      coverage: { complete: true, from: "2026-06-01", to: "2026-06-05" },
    });
    const b = snapshot({
      buckets: [bucket("2026-07-10", 80, 300)],
      coverage: { complete: true, from: "2026-07-01", to: "2026-07-10" },
      observedAt: 2,
    });
    const result = aggregateSnapshots([sourceOf(a), sourceOf(b)]);
    expect(result.overall.coverage).toEqual({
      complete: true,
      from: "2026-06-01",
      to: "2026-07-10",
    });
    expect(result.overall.buckets.map((row) => row.date)).toEqual([
      "2026-06-01",
      "2026-07-10",
    ]);
  });

  it("propagates the worst pricing status when one source is partial", () => {
    const partial = snapshot({
      buckets: [bucket("2026-07-11", 100, 500, "partial")],
      coverage: { complete: false, from: "2026-07-11", to: "2026-07-11" },
    });
    const complete = snapshot({
      buckets: [bucket("2026-07-11", 100, 500)],
      coverage: oneDay("2026-07-11"),
    });
    const result = aggregateSnapshots([sourceOf(partial), sourceOf(complete)]);
    expect(result.overall.buckets[0]!.pricingStatus).toBe("partial");
    expect(result.overall.coverage.complete).toBe(false);
  });

  it("merges byModel breakdowns from every source, summing tokens and cost", () => {
    const a: UsageDataSnapshot = {
      ...snapshot({
        buckets: [bucket("2026-07-11", 100, 500)],
        coverage: oneDay("2026-07-11"),
      }),
      summary: {
        byModel: [
          { estimatedCostMicrousd: 500, modelId: "gpt-5", totalTokens: 100 },
        ],
        estimatedCostMicrousd: 500,
        latestDayTokens: 100,
        periodTokens: 100,
        todayEstimatedCostMicrousd: null,
      },
    };
    const b: UsageDataSnapshot = {
      ...snapshot({
        buckets: [bucket("2026-07-11", 200, 1500)],
        coverage: oneDay("2026-07-11"),
      }),
      summary: {
        byModel: [
          { estimatedCostMicrousd: 1500, modelId: "gpt-5", totalTokens: 200 },
          {
            estimatedCostMicrousd: 200,
            modelId: "claude-sonnet-4-5",
            totalTokens: 50,
          },
        ],
        estimatedCostMicrousd: 1700,
        latestDayTokens: 250,
        periodTokens: 250,
        todayEstimatedCostMicrousd: null,
      },
    };
    const result = aggregateSnapshots([sourceOf(a), sourceOf(b)]);
    const byModel = new Map(
      result.overall.summary.byModel.map((row) => [row.modelId, row])
    );
    expect(byModel.get("gpt-5")).toEqual({
      estimatedCostMicrousd: 2000,
      modelId: "gpt-5",
      totalTokens: 300,
    });
    expect(byModel.get("claude-sonnet-4-5")).toEqual({
      estimatedCostMicrousd: 200,
      modelId: "claude-sonnet-4-5",
      totalTokens: 50,
    });
  });

  it("keeps merged cost null only when every input day is unpriced", () => {
    const unpricedDay = () =>
      snapshot({
        buckets: [bucket("2026-07-11", 100, null, "unpriced")],
        coverage: oneDay("2026-07-11"),
      });
    const result = aggregateSnapshots([
      sourceOf(unpricedDay()),
      sourceOf(unpricedDay()),
    ]);
    expect(result.overall.buckets[0]!.estimatedCostMicrousd).toBeNull();
    expect(result.overall.buckets[0]!.pricingStatus).toBe("unpriced");
  });

  it("marks priced plus unpriced contributions as partial", () => {
    const priced = snapshot({
      buckets: [bucket("2026-07-11", 100, 500, "complete")],
      coverage: oneDay("2026-07-11"),
    });
    const unpriced = snapshot({
      buckets: [bucket("2026-07-11", 200, null, "unpriced")],
      coverage: oneDay("2026-07-11"),
    });
    const result = aggregateSnapshots([sourceOf(priced), sourceOf(unpriced)]);
    expect(result.overall.buckets[0]).toMatchObject({
      estimatedCostMicrousd: 500,
      pricingStatus: "partial",
    });
  });
});
