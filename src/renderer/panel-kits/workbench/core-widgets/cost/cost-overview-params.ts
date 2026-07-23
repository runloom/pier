import type { JsonValue } from "@shared/contracts/plugin-settings.ts";

/**
 * 成本总览物料 params 契约。
 * 宿主视 params 为黑盒——校验收敛在本物料边界，非法字段逐条 salvage。
 */

export type CostOverviewRangeDays = 7 | 14 | 31;
export type CostOverviewMeasure = "cost" | "tokens";
export type CostOverviewGroupBy = "none" | "source" | "model";
export type CostOverviewChart = "stackedBar" | "line" | "ranking";
export type CostOverviewKpiId =
  | "today"
  | "period"
  | "periodTokens"
  | "latestDayTokens";
export type CostOverviewPresetId =
  | "overview"
  | "by-source"
  | "by-model"
  | "tokens"
  | "custom";

export interface CostOverviewParams {
  chart: CostOverviewChart;
  groupBy: CostOverviewGroupBy;
  kpis: CostOverviewKpiId[];
  measure: CostOverviewMeasure;
  /** 仅用于设置页展示「当前像哪个官方预设」；缺省或与字段不一致时视为 custom */
  preset?: CostOverviewPresetId;
  rangeDays: CostOverviewRangeDays;
  /** sourceId 白名单；缺省或空 = 全部来源 */
  sources?: string[];
}

const RANGE_DAYS: Record<number, true> = { 7: true, 14: true, 31: true };
const MEASURES: Record<CostOverviewMeasure, true> = {
  cost: true,
  tokens: true,
};
const GROUP_BYS: Record<CostOverviewGroupBy, true> = {
  none: true,
  source: true,
  model: true,
};
const CHARTS: Record<CostOverviewChart, true> = {
  stackedBar: true,
  line: true,
  ranking: true,
};
const KPI_IDS: Record<CostOverviewKpiId, true> = {
  today: true,
  period: true,
  periodTokens: true,
  latestDayTokens: true,
};
const PRESET_IDS: Record<CostOverviewPresetId, true> = {
  overview: true,
  "by-source": true,
  "by-model": true,
  tokens: true,
  custom: true,
};
const OFFICIAL_PRESET_IDS = [
  "overview",
  "by-source",
  "by-model",
  "tokens",
] as const satisfies readonly Exclude<CostOverviewPresetId, "custom">[];

const DEFAULT_KPIS: CostOverviewKpiId[] = [
  "today",
  "period",
  "periodTokens",
  "latestDayTokens",
];

export const DEFAULT_COST_OVERVIEW_PARAMS: CostOverviewParams = {
  preset: "overview",
  rangeDays: 31,
  measure: "cost",
  groupBy: "source",
  chart: "stackedBar",
  kpis: [...DEFAULT_KPIS],
};

export const COST_OVERVIEW_PRESETS: Record<
  Exclude<CostOverviewPresetId, "custom">,
  CostOverviewParams
> = {
  overview: {
    preset: "overview",
    rangeDays: 31,
    measure: "cost",
    groupBy: "source",
    chart: "stackedBar",
    kpis: [...DEFAULT_KPIS],
  },
  "by-source": {
    preset: "by-source",
    rangeDays: 31,
    measure: "cost",
    groupBy: "source",
    chart: "stackedBar",
    kpis: ["today", "period"],
  },
  "by-model": {
    preset: "by-model",
    rangeDays: 31,
    measure: "cost",
    groupBy: "model",
    chart: "ranking",
    kpis: ["period", "periodTokens"],
  },
  tokens: {
    preset: "tokens",
    rangeDays: 31,
    measure: "tokens",
    groupBy: "none",
    chart: "line",
    kpis: ["periodTokens", "latestDayTokens", "period"],
  },
};

export function paramsFromPreset(
  preset: Exclude<CostOverviewPresetId, "custom">
): CostOverviewParams {
  const template = COST_OVERVIEW_PRESETS[preset];
  return {
    ...template,
    kpis: [...template.kpis],
    ...(template.sources ? { sources: [...template.sources] } : {}),
  };
}

/**
 * groupBy × chart 兼容矩阵：
 * - none → line | stackedBar；ranking → line
 * - source → stackedBar only
 * - model → ranking only
 */
export function normalizeCostOverviewChart(
  groupBy: CostOverviewGroupBy,
  chart: CostOverviewChart
): CostOverviewChart {
  switch (groupBy) {
    case "source":
      return "stackedBar";
    case "model":
      return "ranking";
    case "none":
      return chart === "ranking" ? "line" : chart;
    default:
      return chart;
  }
}

function isRangeDays(value: unknown): value is CostOverviewRangeDays {
  return typeof value === "number" && RANGE_DAYS[value] === true;
}

function isMeasure(value: unknown): value is CostOverviewMeasure {
  return (
    typeof value === "string" && MEASURES[value as CostOverviewMeasure] === true
  );
}

function isGroupBy(value: unknown): value is CostOverviewGroupBy {
  return (
    typeof value === "string" &&
    GROUP_BYS[value as CostOverviewGroupBy] === true
  );
}

function isChart(value: unknown): value is CostOverviewChart {
  return (
    typeof value === "string" && CHARTS[value as CostOverviewChart] === true
  );
}

function isKpiId(value: unknown): value is CostOverviewKpiId {
  return (
    typeof value === "string" && KPI_IDS[value as CostOverviewKpiId] === true
  );
}

function isPresetId(value: unknown): value is CostOverviewPresetId {
  return (
    typeof value === "string" &&
    PRESET_IDS[value as CostOverviewPresetId] === true
  );
}

function isOfficialPresetId(
  value: unknown
): value is Exclude<CostOverviewPresetId, "custom"> {
  return (
    typeof value === "string" &&
    (OFFICIAL_PRESET_IDS as readonly string[]).includes(value)
  );
}

function parseKpis(raw: unknown): CostOverviewKpiId[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_KPIS];
  }
  const seen = new Set<CostOverviewKpiId>();
  const result: CostOverviewKpiId[] = [];
  for (const item of raw) {
    if (!isKpiId(item) || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
    if (result.length >= 4) break;
  }
  return result.length > 0 ? result : [...DEFAULT_KPIS];
}

function parseSources(raw: unknown): string[] | undefined {
  // null / missing / empty = no filter (all sources). Host shallow-merges
  // params, so clear must round-trip via explicit null from toJson.
  if (raw == null || !Array.isArray(raw)) {
    return;
  }
  const sources = raw.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );
  return sources.length > 0 ? sources : undefined;
}

function sourcesEqual(
  a: string[] | undefined,
  b: string[] | undefined
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length === 0 && right.length === 0) return true;
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function kpisEqual(a: CostOverviewKpiId[], b: CostOverviewKpiId[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

/** 除 preset 外字段 deep equal；sources 的 undefined 与 [] 视为相等 */
function paramsFieldsEqual(
  a: CostOverviewParams,
  b: CostOverviewParams
): boolean {
  return (
    a.rangeDays === b.rangeDays &&
    a.measure === b.measure &&
    a.groupBy === b.groupBy &&
    a.chart === b.chart &&
    kpisEqual(a.kpis, b.kpis) &&
    sourcesEqual(a.sources, b.sources)
  );
}

function resolvePresetId(params: CostOverviewParams): CostOverviewPresetId {
  for (const id of OFFICIAL_PRESET_IDS) {
    if (paramsFieldsEqual(params, COST_OVERVIEW_PRESETS[id])) {
      return id;
    }
  }
  return "custom";
}

export function parseCostOverviewParams(
  raw: Readonly<Record<string, unknown>>
): CostOverviewParams {
  const rangeDays = isRangeDays(raw.rangeDays)
    ? raw.rangeDays
    : DEFAULT_COST_OVERVIEW_PARAMS.rangeDays;
  const measure = isMeasure(raw.measure)
    ? raw.measure
    : DEFAULT_COST_OVERVIEW_PARAMS.measure;
  const groupBy = isGroupBy(raw.groupBy)
    ? raw.groupBy
    : DEFAULT_COST_OVERVIEW_PARAMS.groupBy;
  const chartRaw = isChart(raw.chart)
    ? raw.chart
    : DEFAULT_COST_OVERVIEW_PARAMS.chart;
  const chart = normalizeCostOverviewChart(groupBy, chartRaw);
  const kpis = parseKpis(raw.kpis);
  const sources = parseSources(raw.sources);

  const candidate: CostOverviewParams = {
    rangeDays,
    measure,
    groupBy,
    chart,
    kpis,
    ...(sources ? { sources } : {}),
  };

  const preset = isPresetId(raw.preset)
    ? raw.preset
    : resolvePresetId(candidate);

  return {
    ...candidate,
    preset,
  };
}

/** Patch may explicitly clear optional fields with `undefined` (e.g. sources → all). */
export type CostOverviewParamsPatch = {
  [K in keyof CostOverviewParams]?: CostOverviewParams[K] | undefined;
};

export function patchCostOverviewParams(
  current: CostOverviewParams,
  patch: CostOverviewParamsPatch
): CostOverviewParams {
  if (isOfficialPresetId(patch.preset)) {
    return paramsFromPreset(patch.preset);
  }

  const groupBy = patch.groupBy ?? current.groupBy;
  const chartRaw = patch.chart ?? current.chart;
  const chart = normalizeCostOverviewChart(groupBy, chartRaw);

  const merged: CostOverviewParams = {
    rangeDays: patch.rangeDays ?? current.rangeDays,
    measure: patch.measure ?? current.measure,
    groupBy,
    chart,
    kpis: patch.kpis ? [...patch.kpis] : [...current.kpis],
  };

  if ("sources" in patch) {
    if (patch.sources && patch.sources.length > 0) {
      merged.sources = [...patch.sources];
    }
  } else if (current.sources && current.sources.length > 0) {
    merged.sources = [...current.sources];
  }

  return {
    ...merged,
    preset: resolvePresetId(merged),
  };
}

export function costOverviewParamsToJson(
  params: CostOverviewParams
): Record<string, JsonValue> {
  const json: Record<string, JsonValue> = {
    chart: params.chart,
    groupBy: params.groupBy,
    kpis: [...params.kpis],
    measure: params.measure,
    rangeDays: params.rangeDays,
  };
  if (params.preset !== undefined) {
    json.preset = params.preset;
  }
  // Always write sources so host shallow-merge can clear a prior allowlist.
  json.sources =
    params.sources && params.sources.length > 0 ? [...params.sources] : null;
  return json;
}
