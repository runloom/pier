import type {
  UsageAggregateSnapshot,
  UsageAggregateSource,
  UsageDataDailyBucket,
  UsageDataPricingStatus,
  UsageDataSummary,
  UsageModelBreakdown,
  UsageTokenTotals,
} from "@shared/contracts/usage-data.ts";
import { describe, expect, it } from "vitest";
import {
  type CostOverviewParams,
  DEFAULT_COST_OVERVIEW_PARAMS,
} from "@/panel-kits/workbench/core-widgets/cost/cost-overview-params.ts";
import { costViewQuery } from "@/panel-kits/workbench/core-widgets/cost/cost-view-query.ts";

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

function modelRow(
  modelId: string,
  cost: number | null,
  totalTokens: number
): UsageModelBreakdown {
  return { estimatedCostMicrousd: cost, modelId, totalTokens };
}

function sourceSummary(
  patch: Partial<UsageDataSummary> = {}
): UsageDataSummary {
  return {
    byModel: [],
    estimatedCostMicrousd: null,
    latestDayTokens: 0,
    periodTokens: 0,
    todayEstimatedCostMicrousd: null,
    ...patch,
  };
}

function makeSource(
  sourceId: string,
  buckets: UsageDataDailyBucket[],
  summary: UsageDataSummary = sourceSummary(),
  pluginId = "plugin-a"
): UsageAggregateSource {
  const from = buckets[0]?.date ?? "2026-07-11";
  const to = buckets.at(-1)?.date ?? "2026-07-11";
  return {
    pluginId,
    scope: { kind: "machine" },
    snapshot: {
      buckets,
      coverage: { complete: true, from, to },
      observedAt: 1_700_000_000_000,
      pluginId,
      scope: { kind: "machine" },
      sourceId,
      summary,
    },
    sourceId,
  };
}

function makeSnapshot(
  sources: UsageAggregateSource[],
  overallPatch: Partial<UsageAggregateSnapshot["overall"]> = {}
): UsageAggregateSnapshot {
  const dates = new Set<string>();
  for (const source of sources) {
    for (const b of source.snapshot.buckets) dates.add(b.date);
  }
  const sorted = [...dates].sort();
  return {
    overall: {
      buckets: sorted.map((date) => bucket(date, 0, null)),
      coverage: {
        complete: true,
        from: sorted[0] ?? "2026-07-11",
        to: sorted.at(-1) ?? "2026-07-11",
      },
      observedAt: 1_700_000_000_000,
      summary: {
        byModel: [],
        estimatedCostMicrousd: null,
        latestDayTokens: 0,
        periodTokens: 0,
        sourceCount: sources.length,
        todayEstimatedCostMicrousd: null,
      },
      ...overallPatch,
    },
    sources,
  };
}

const resolveSourceLabel = (pluginId: string, sourceId: string) =>
  `${pluginId}/${sourceId}`;

/** Dual-source fixture: 2026-07-01 … 2026-07-11 with data at both ends. */
function dualSourceFixture() {
  const sourceA = makeSource(
    "src-a",
    [
      bucket("2026-07-01", 100, 1_000_000),
      bucket("2026-07-05", 0, 0),
      bucket("2026-07-11", 50, 500_000),
    ],
    sourceSummary({
      byModel: [
        modelRow("gpt-4", 1_200_000, 120),
        modelRow("claude", 300_000, 30),
      ],
      estimatedCostMicrousd: 1_500_000,
      latestDayTokens: 50,
      periodTokens: 150,
      todayEstimatedCostMicrousd: 500_000,
    })
  );
  const sourceB = makeSource(
    "src-b",
    [
      bucket("2026-07-01", 200, 2_000_000),
      bucket("2026-07-08", 80, 800_000),
      bucket("2026-07-11", 40, 400_000),
    ],
    sourceSummary({
      byModel: [modelRow("gpt-4", 2_500_000, 250), modelRow("", 700_000, 70)],
      estimatedCostMicrousd: 3_200_000,
      latestDayTokens: 40,
      periodTokens: 320,
      todayEstimatedCostMicrousd: 400_000,
    }),
    "plugin-b"
  );
  // Lying overall summary: huge period that must NOT be trusted blindly.
  const snapshot = makeSnapshot([sourceA, sourceB], {
    coverage: { complete: true, from: "2026-07-01", to: "2026-07-11" },
    summary: {
      byModel: [],
      estimatedCostMicrousd: 99_000_000,
      latestDayTokens: 999,
      periodTokens: 9999,
      sourceCount: 2,
      todayEstimatedCostMicrousd: 9_000_000,
    },
  });
  return { snapshot, sourceA, sourceB };
}

function query(
  snapshot: UsageAggregateSnapshot | null,
  params: CostOverviewParams = DEFAULT_COST_OVERVIEW_PARAMS
) {
  return costViewQuery({
    params,
    resolveSourceLabel,
    snapshot,
  });
}

describe("costViewQuery", () => {
  it("returns no-sources when snapshot is null", () => {
    const view = query(null);
    expect(view.emptyReason).toBe("no-sources");
    expect(view.series).toEqual([]);
    expect(view.ranking).toEqual([]);
    expect(view.sourceMetas).toEqual([]);
    expect(view.kpis).toEqual({
      latestDataDate: null,
      latestDayTokens: 0,
      period: null,
      periodTokens: 0,
      today: null,
    });
    expect(view.observedAt).toBe(0);
    expect(view.rangeDays).toBe(DEFAULT_COST_OVERVIEW_PARAMS.rangeDays);
    expect(view.measure).toBe(DEFAULT_COST_OVERVIEW_PARAMS.measure);
    expect(view.groupBy).toBe(DEFAULT_COST_OVERVIEW_PARAMS.groupBy);
    expect(view.chart).toBe(DEFAULT_COST_OVERVIEW_PARAMS.chart);
  });

  it("returns no-sources when sources array is empty", () => {
    const view = query(makeSnapshot([]));
    expect(view.emptyReason).toBe("no-sources");
    expect(view.observedAt).toBe(0);
  });

  it("recomputes period cost from windowed buckets (ignores lying summary)", () => {
    const { snapshot } = dualSourceFixture();
    // Manual sum: A 1+0.5 + B 2+0.8+0.4 = 4.7 USD
    const view = query(snapshot);
    expect(view.kpis.period).toBeCloseTo(4.7);
    expect(view.kpis.today).toBeCloseTo(0.9); // 0.5 + 0.4 on coverage.to
    expect(view.kpis.periodTokens).toBe(470); // 100+0+50 + 200+80+40
    expect(view.kpis.latestDayTokens).toBe(90); // 50+40 on 2026-07-11
    expect(view.kpis.latestDataDate).toBe("2026-07-11");
    expect(view.emptyReason).toBeNull();
    expect(view.observedAt).toBe(1_700_000_000_000);
  });

  it("truncates by rangeDays calendar window ending at coverage.to", () => {
    const { snapshot } = dualSourceFixture();
    const view = query(snapshot, {
      ...DEFAULT_COST_OVERVIEW_PARAMS,
      rangeDays: 7,
    });
    // Window: 2026-07-05 .. 2026-07-11 — excludes 2026-07-01
    // Costs: A 0+0.5 + B 0.8+0.4 = 1.7
    expect(view.kpis.period).toBeCloseTo(1.7);
    expect(view.kpis.periodTokens).toBe(170); // 0+50 + 80+40
    const dates = view.series.map((row) => row.date);
    expect(dates).not.toContain("2026-07-01");
    expect(dates).toEqual(expect.arrayContaining(["2026-07-08", "2026-07-11"]));
  });

  it("builds tokens value series for groupBy none", () => {
    const { snapshot } = dualSourceFixture();
    const view = query(snapshot, {
      ...DEFAULT_COST_OVERVIEW_PARAMS,
      chart: "line",
      groupBy: "none",
      measure: "tokens",
    });
    expect(view.series).toEqual([
      { date: "2026-07-01", value: 300 },
      // 2026-07-05 total tokens = 0 → dropped
      { date: "2026-07-08", value: 80 },
      { date: "2026-07-11", value: 90 },
    ]);
    expect(view.ranking).toEqual([]);
  });

  it("builds stacked source series and drops all-zero rows", () => {
    const { snapshot } = dualSourceFixture();
    const view = query(snapshot);
    expect(view.sourceMetas).toEqual([
      {
        color: "var(--chart-1)",
        dataKey: "source0",
        label: "plugin-a/src-a",
      },
      {
        color: "var(--chart-2)",
        dataKey: "source1",
        label: "plugin-b/src-b",
      },
    ]);
    // 2026-07-05 has cost 0 across sources → dropped
    expect(view.series).toEqual([
      { date: "2026-07-01", source0: 1, source1: 2 },
      { date: "2026-07-08", source0: 0, source1: 0.8 },
      { date: "2026-07-11", source0: 0.5, source1: 0.4 },
    ]);
  });

  it("filters to selected sources by sourceId", () => {
    const { snapshot } = dualSourceFixture();
    const view = query(snapshot, {
      ...DEFAULT_COST_OVERVIEW_PARAMS,
      sources: ["src-a"],
    });
    expect(view.sourceMetas).toHaveLength(1);
    expect(view.sourceMetas[0]?.label).toBe("plugin-a/src-a");
    // Only A: 1 + 0 + 0.5 = 1.5
    expect(view.kpis.period).toBeCloseTo(1.5);
    expect(view.kpis.today).toBeCloseTo(0.5);
    expect(view.series.every((row) => !("source1" in row))).toBe(true);
  });

  it("returns filtered-empty when sources filter matches nothing", () => {
    const { snapshot } = dualSourceFixture();
    const view = query(snapshot, {
      ...DEFAULT_COST_OVERVIEW_PARAMS,
      sources: ["only-missing"],
    });
    expect(view.emptyReason).toBe("filtered-empty");
    expect(view.series).toEqual([]);
    expect(view.ranking).toEqual([]);
    expect(view.sourceMetas).toEqual([]);
  });

  it("merges byModel across sources for ranking", () => {
    const { snapshot } = dualSourceFixture();
    const view = query(snapshot, {
      ...DEFAULT_COST_OVERVIEW_PARAMS,
      chart: "ranking",
      groupBy: "model",
      measure: "cost",
    });
    // gpt-4: 1.2 + 2.5 = 3.7; unknown: 0.7; claude: 0.3
    expect(view.ranking).toEqual([
      { label: "gpt-4", value: 3.7 },
      { label: "unknown", value: 0.7 },
      { label: "claude", value: 0.3 },
    ]);
    expect(view.series).toEqual([]);
    expect(view.emptyReason).toBeNull();
  });

  it("merges byModel tokens when measure is tokens", () => {
    const { snapshot } = dualSourceFixture();
    const view = query(snapshot, {
      ...DEFAULT_COST_OVERVIEW_PARAMS,
      chart: "ranking",
      groupBy: "model",
      measure: "tokens",
    });
    expect(view.ranking).toEqual([
      { label: "gpt-4", value: 370 },
      { label: "unknown", value: 70 },
      { label: "claude", value: 30 },
    ]);
  });

  it("counts unpriced days in window after source filter", () => {
    const source = makeSource("src-a", [
      bucket("2026-07-01", 10, null, "unpriced"),
      bucket("2026-07-10", 10, 100_000, "partial"),
      bucket("2026-07-11", 10, 200_000, "complete"),
    ]);
    const snapshot = makeSnapshot([source], {
      coverage: { complete: false, from: "2026-07-01", to: "2026-07-11" },
    });
    const view = query(snapshot, {
      ...DEFAULT_COST_OVERVIEW_PARAMS,
      rangeDays: 7,
    });
    // Window 07-05..07-11: 07-10 partial + not 07-01
    expect(view.unpricedDayCount).toBe(1);
  });

  it("returns no-points-in-range when sources exist but series and ranking empty", () => {
    const source = makeSource("src-a", [bucket("2026-07-01", 0, 0)]);
    const snapshot = makeSnapshot([source], {
      coverage: { complete: true, from: "2026-07-01", to: "2026-07-11" },
    });
    const view = query(snapshot, {
      ...DEFAULT_COST_OVERVIEW_PARAMS,
      rangeDays: 7, // excludes 2026-07-01
    });
    expect(view.series).toEqual([]);
    expect(view.ranking).toEqual([]);
    expect(view.emptyReason).toBe("no-points-in-range");
  });

  it("returns null period when window has no priced cost points", () => {
    const source = makeSource("src-a", [
      bucket("2026-07-11", 40, null, "unpriced"),
    ]);
    const snapshot = makeSnapshot([source], {
      coverage: { complete: false, from: "2026-07-11", to: "2026-07-11" },
    });
    const view = query(snapshot);
    expect(view.kpis.period).toBeNull();
    expect(view.kpis.today).toBeNull();
    expect(view.kpis.periodTokens).toBe(40);
  });
});
