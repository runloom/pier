/**
 * 成本总览视图查询：snapshot + params → CostViewModel。
 * 纯函数，无 React / i18n / I/O。
 */

import type {
  UsageAggregateSnapshot,
  UsageAggregateSource,
  UsageDataDailyBucket,
} from "@shared/contracts/usage-data.ts";
import type {
  CostOverviewChart,
  CostOverviewGroupBy,
  CostOverviewMeasure,
  CostOverviewParams,
  CostOverviewRangeDays,
} from "./cost-overview-params.ts";

const SOURCE_COLOR_TOKENS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

const MICROUSD_PER_USD = 1_000_000;
const MS_PER_DAY = 86_400_000;

export type CostViewEmptyReason =
  | "no-sources"
  | "no-points-in-range"
  | "filtered-empty";

export interface CostViewSourceMeta {
  color: string;
  dataKey: string;
  label: string;
}

export interface CostViewSeriesRow {
  date: string;
  value?: number;
  [dataKey: string]: string | number | undefined;
}

export interface CostViewRankingRow {
  label: string;
  value: number;
}

export interface CostViewKpis {
  latestDataDate: string | null;
  latestDayTokens: number;
  /** period cost in USD; null when window has no priced points */
  period: number | null;
  periodTokens: number;
  /** today (coverage.to) cost in USD */
  today: number | null;
}

export interface CostViewModel {
  chart: CostOverviewChart;
  emptyReason: CostViewEmptyReason | null;
  groupBy: CostOverviewGroupBy;
  kpis: CostViewKpis;
  measure: CostOverviewMeasure;
  observedAt: number;
  rangeDays: CostOverviewRangeDays;
  ranking: readonly CostViewRankingRow[];
  series: readonly CostViewSeriesRow[];
  sourceMetas: readonly CostViewSourceMeta[];
  unpricedDayCount: number;
}

export interface CostViewQueryInput {
  params: CostOverviewParams;
  resolveSourceLabel: (pluginId: string, sourceId: string) => string;
  snapshot: UsageAggregateSnapshot | null;
}

function addUtcDays(date: string, deltaDays: number): string {
  const ms = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(ms)) return date;
  return new Date(ms + deltaDays * MS_PER_DAY).toISOString().slice(0, 10);
}

function emptyModel(
  params: CostOverviewParams,
  emptyReason: CostViewEmptyReason,
  observedAt = 0
): CostViewModel {
  return {
    chart: params.chart,
    emptyReason,
    groupBy: params.groupBy,
    kpis: {
      latestDataDate: null,
      latestDayTokens: 0,
      period: null,
      periodTokens: 0,
      today: null,
    },
    measure: params.measure,
    observedAt,
    rangeDays: params.rangeDays,
    ranking: [],
    series: [],
    sourceMetas: [],
    unpricedDayCount: 0,
  };
}

function measureOf(
  bucket: UsageDataDailyBucket | undefined,
  measure: CostOverviewMeasure
): number {
  if (bucket === undefined) return 0;
  if (measure === "tokens") return bucket.tokens.totalTokens;
  return bucket.estimatedCostMicrousd === null
    ? 0
    : bucket.estimatedCostMicrousd / MICROUSD_PER_USD;
}

function buildSeries(
  dates: readonly string[],
  bySource: readonly Map<string, UsageDataDailyBucket>[],
  metas: readonly CostViewSourceMeta[],
  groupBy: CostOverviewGroupBy,
  measure: CostOverviewMeasure
): CostViewSeriesRow[] {
  if (groupBy === "model") return [];
  const rows: CostViewSeriesRow[] = [];
  for (const date of dates) {
    if (groupBy === "none") {
      let total = 0;
      for (const map of bySource) total += measureOf(map.get(date), measure);
      if (total !== 0) rows.push({ date, value: total });
      continue;
    }
    const row: CostViewSeriesRow = { date };
    let total = 0;
    for (let i = 0; i < metas.length; i += 1) {
      const value = measureOf(bySource[i]?.get(date), measure);
      row[metas[i]!.dataKey] = value;
      total += value;
    }
    if (total !== 0) rows.push(row);
  }
  return rows;
}

function buildRanking(
  sources: readonly UsageAggregateSource[],
  measure: CostOverviewMeasure
): CostViewRankingRow[] {
  interface Acc {
    hasCost: boolean;
    microusd: number;
    tokens: number;
  }
  const acc = new Map<string, Acc>();
  for (const source of sources) {
    for (const row of source.snapshot.summary.byModel) {
      const key = row.modelId || "unknown";
      const cur = acc.get(key) ?? { hasCost: false, microusd: 0, tokens: 0 };
      cur.tokens += row.totalTokens;
      if (row.estimatedCostMicrousd !== null) {
        cur.microusd += row.estimatedCostMicrousd;
        cur.hasCost = true;
      }
      acc.set(key, cur);
    }
  }
  const ranking: CostViewRankingRow[] = [];
  for (const [label, row] of acc) {
    if (measure === "tokens") {
      if (row.tokens > 0) ranking.push({ label, value: row.tokens });
    } else if (row.hasCost) {
      ranking.push({ label, value: row.microusd / MICROUSD_PER_USD });
    }
  }
  ranking.sort((a, b) => b.value - a.value);
  return ranking;
}

function computeKpis(
  bySource: readonly Map<string, UsageDataDailyBucket>[],
  dates: readonly string[],
  todayDate: string
): CostViewKpis {
  let periodMicro = 0;
  let hasPriced = false;
  let periodTokens = 0;
  let todayMicro = 0;
  let hasToday = false;
  let latestDataDate: string | null = null;
  let latestDayTokens = 0;

  for (const date of dates) {
    let dayTokens = 0;
    for (const map of bySource) {
      const bucket = map.get(date);
      if (bucket === undefined) continue;
      dayTokens += bucket.tokens.totalTokens;
      periodTokens += bucket.tokens.totalTokens;
      if (bucket.estimatedCostMicrousd !== null) {
        periodMicro += bucket.estimatedCostMicrousd;
        hasPriced = true;
        if (date === todayDate) {
          todayMicro += bucket.estimatedCostMicrousd;
          hasToday = true;
        }
      }
    }
    if (dayTokens > 0) {
      latestDataDate = date;
      latestDayTokens = dayTokens;
    }
  }

  return {
    latestDataDate,
    latestDayTokens,
    period: hasPriced ? periodMicro / MICROUSD_PER_USD : null,
    periodTokens,
    today: hasToday ? todayMicro / MICROUSD_PER_USD : null,
  };
}

/**
 * 从 usage 聚合快照与物料 params 派生 KPI / series / ranking。
 * range、sources 过滤与 KPI 一律在此重算，不盲信 summary 31d 字段。
 */
export function costViewQuery(input: CostViewQueryInput): CostViewModel {
  const { params, resolveSourceLabel, snapshot } = input;

  if (snapshot === null || snapshot.sources.length === 0) {
    return emptyModel(params, "no-sources");
  }

  const allow =
    params.sources !== undefined && params.sources.length > 0
      ? new Set(params.sources)
      : null;
  const filtered = allow
    ? snapshot.sources.filter((s) => allow.has(s.sourceId))
    : [...snapshot.sources];
  if (filtered.length === 0) {
    return emptyModel(params, "filtered-empty", snapshot.overall.observedAt);
  }

  const to = snapshot.overall.coverage.to;
  const from = addUtcDays(to, -(params.rangeDays - 1));

  const bySource = filtered.map((source) => {
    const map = new Map<string, UsageDataDailyBucket>();
    for (const bucket of source.snapshot.buckets) {
      if (bucket.date >= from && bucket.date <= to)
        map.set(bucket.date, bucket);
    }
    return map;
  });

  const dateSet = new Set<string>();
  for (const map of bySource) {
    for (const date of map.keys()) dateSet.add(date);
  }
  for (const bucket of snapshot.overall.buckets) {
    if (bucket.date >= from && bucket.date <= to) dateSet.add(bucket.date);
  }
  const dates = [...dateSet].sort();

  const sourceMetas: CostViewSourceMeta[] = filtered.map((source, index) => ({
    color: SOURCE_COLOR_TOKENS[index % SOURCE_COLOR_TOKENS.length]!,
    dataKey: `source${index}`,
    label: resolveSourceLabel(source.pluginId, source.sourceId),
  }));

  const series = buildSeries(
    dates,
    bySource,
    sourceMetas,
    params.groupBy,
    params.measure
  );
  const ranking =
    params.groupBy === "model" ? buildRanking(filtered, params.measure) : [];

  let unpricedDayCount = 0;
  for (const date of dates) {
    for (const map of bySource) {
      const bucket = map.get(date);
      if (bucket !== undefined && bucket.pricingStatus !== "complete") {
        unpricedDayCount += 1;
        break;
      }
    }
  }

  return {
    chart: params.chart,
    emptyReason:
      series.length === 0 && ranking.length === 0 ? "no-points-in-range" : null,
    groupBy: params.groupBy,
    kpis: computeKpis(bySource, dates, to),
    measure: params.measure,
    observedAt: snapshot.overall.observedAt,
    rangeDays: params.rangeDays,
    ranking,
    series,
    sourceMetas,
    unpricedDayCount,
  };
}
