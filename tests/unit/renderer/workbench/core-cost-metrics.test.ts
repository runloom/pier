import type {
  UsageAggregateSnapshot,
  UsageAggregateSource,
  UsageDataDailyBucket,
  UsageDataPricingStatus,
  UsageDataSummary,
  UsageTokenTotals,
} from "@shared/contracts/usage-data.ts";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ensureCoreMetricsRegistered,
  resetCoreMetricsForTests,
} from "@/lib/workbench/core-metrics.ts";
import {
  clearMetricsForTests,
  getMetricRegistration,
} from "@/lib/workbench/metric-registry.ts";
import { useUsageDataStore } from "@/stores/usage-data.store.ts";

function readValue(id: string) {
  return getMetricRegistration(id)?.read() ?? null;
}

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

function stubSource(
  pluginId: string,
  cost: number | null
): UsageAggregateSource {
  return {
    pluginId,
    scope: { kind: "machine" },
    snapshot: {
      buckets: [],
      coverage: { complete: true, from: "2026-07-11", to: "2026-07-11" },
      observedAt: 1,
      pluginId,
      scope: { kind: "machine" },
      sourceId: "local-sessions",
      summary: {
        byModel: [],
        estimatedCostMicrousd: cost,
        latestDayTokens: 0,
        periodTokens: 0,
        todayEstimatedCostMicrousd: null,
      },
    },
    sourceId: "local-sessions",
  };
}

const EMPTY_SUMMARY: UsageAggregateSnapshot["overall"]["summary"] = {
  byModel: [],
  estimatedCostMicrousd: null,
  latestDayTokens: 0,
  periodTokens: 0,
  sourceCount: 0,
  todayEstimatedCostMicrousd: null,
};

function makeSnapshot(
  patch: Partial<UsageAggregateSnapshot["overall"]> = {},
  sources: UsageAggregateSnapshot["sources"] = []
): UsageAggregateSnapshot {
  return {
    overall: {
      buckets: [],
      coverage: { complete: true, from: "2026-07-11", to: "2026-07-11" },
      observedAt: 1,
      summary: EMPTY_SUMMARY,
      ...patch,
    },
    sources,
  };
}

function summary(
  patch: Partial<UsageDataSummary & { sourceCount: number }>
): UsageAggregateSnapshot["overall"]["summary"] {
  return { ...EMPTY_SUMMARY, ...patch };
}

describe("core.cost.* metrics", () => {
  beforeEach(() => {
    clearMetricsForTests();
    resetCoreMetricsForTests();
    useUsageDataStore.getState().reset();
    ensureCoreMetricsRegistered();
  });

  it("returns null values before any snapshot lands", () => {
    expect(readValue("core.cost.today")).toEqual({
      kind: "instant",
      value: null,
    });
    expect(readValue("core.cost.periodInstant")).toEqual({
      kind: "instant",
      value: null,
    });
    expect(readValue("core.cost.periodTokens")).toEqual({
      kind: "instant",
      value: null,
    });
    expect(readValue("core.cost.dailySeries")).toEqual({
      kind: "series",
      points: [],
    });
    expect(readValue("core.cost.byModel")).toEqual({
      items: [],
      kind: "grouped",
    });
    expect(readValue("core.cost.bySource")).toEqual({
      items: [],
      kind: "grouped",
    });
  });

  it("projects today + period + tokens as microusd/1e6", () => {
    useUsageDataStore.getState().applySnapshot(
      makeSnapshot({
        summary: summary({
          estimatedCostMicrousd: 12_500_000,
          periodTokens: 42_000,
          sourceCount: 1,
          todayEstimatedCostMicrousd: 3_000_000,
        }),
      })
    );

    expect(readValue("core.cost.today")).toEqual({ kind: "instant", value: 3 });
    expect(readValue("core.cost.periodInstant")).toEqual({
      kind: "instant",
      value: 12.5,
    });
    expect(readValue("core.cost.periodTokens")).toEqual({
      kind: "instant",
      value: 42_000,
    });
  });

  it("emits dailySeries points with UTC-noon timestamps and USD value", () => {
    useUsageDataStore.getState().applySnapshot(
      makeSnapshot({
        buckets: [
          bucket("2026-07-10", 100, 1_000_000),
          bucket("2026-07-11", 50, null, "unpriced"),
          bucket("2026-07-12", 200, 2_500_000),
        ],
      })
    );

    const value = readValue("core.cost.dailySeries");
    expect(value?.kind).toBe("series");
    if (value?.kind !== "series") throw new Error("expected series");
    expect(value.points).toEqual([
      { ts: Date.parse("2026-07-10T12:00:00Z"), value: 1 },
      { ts: Date.parse("2026-07-12T12:00:00Z"), value: 2.5 },
    ]);
  });

  it("sorts byModel descending and drops unpriced rows", () => {
    useUsageDataStore.getState().applySnapshot(
      makeSnapshot({
        summary: summary({
          byModel: [
            {
              estimatedCostMicrousd: 500_000,
              modelId: "gpt-5",
              totalTokens: 100,
            },
            {
              estimatedCostMicrousd: 2_500_000,
              modelId: "claude-sonnet-4-5",
              totalTokens: 400,
            },
            {
              estimatedCostMicrousd: null,
              modelId: "future-model",
              totalTokens: 50,
            },
          ],
          estimatedCostMicrousd: 3_000_000,
          periodTokens: 550,
          sourceCount: 2,
        }),
      })
    );

    const value = readValue("core.cost.byModel");
    expect(value).toEqual({
      items: [
        { label: "claude-sonnet-4-5", value: 2.5 },
        { label: "gpt-5", value: 0.5 },
      ],
      kind: "grouped",
    });
  });

  it("sorts bySource descending using plugin/source label", () => {
    useUsageDataStore.getState().applySnapshot(
      makeSnapshot(
        {
          summary: summary({
            estimatedCostMicrousd: 2_000_000,
            sourceCount: 2,
          }),
        },
        [
          stubSource("pier.codex", 500_000),
          stubSource("pier.claude", 1_500_000),
        ]
      )
    );

    const value = readValue("core.cost.bySource");
    expect(value).toEqual({
      items: [
        { label: "pier.claude/local-sessions", value: 1.5 },
        { label: "pier.codex/local-sessions", value: 0.5 },
      ],
      kind: "grouped",
    });
  });
});
