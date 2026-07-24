import { Checkbox } from "@pier/ui/checkbox.tsx";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@pier/ui/field.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pier/ui/select.tsx";
import { ToggleGroup, ToggleGroupItem } from "@pier/ui/toggle-group.tsx";
import type { WorkbenchWidgetSettingsProps } from "@plugins/api/renderer.ts";
import { useMemo } from "react";
import { useT } from "@/i18n/use-t.ts";
import { resolveUsageSourceLabel } from "@/lib/workbench/usage-source-labels.ts";
import { useUsageDataStore } from "@/stores/usage-data.store.ts";
import {
  type CostOverviewChart,
  type CostOverviewGroupBy,
  type CostOverviewKpiId,
  type CostOverviewMeasure,
  type CostOverviewParamsPatch,
  type CostOverviewPresetId,
  type CostOverviewRangeDays,
  costOverviewParamsToJson,
  normalizeCostOverviewChart,
  parseCostOverviewParams,
  patchCostOverviewParams,
} from "./cost-overview-params.ts";

const I18N = "workbench.widget.costOverview.settings" as const;

const SETTINGS_PRESETS = [
  "overview",
  "by-source",
  "by-model",
  "tokens",
] as const satisfies readonly Exclude<CostOverviewPresetId, "custom">[];

const RANGE_OPTIONS: readonly CostOverviewRangeDays[] = [7, 14, 31];
const MEASURE_OPTIONS: readonly CostOverviewMeasure[] = ["cost", "tokens"];
const GROUP_BY_OPTIONS: readonly CostOverviewGroupBy[] = [
  "none",
  "source",
  "model",
];
const KPI_OPTIONS: readonly CostOverviewKpiId[] = [
  "today",
  "period",
  "periodTokens",
  "latestDayTokens",
];

const PRESET_LABEL = {
  "by-model": `${I18N}.presetByModel`,
  "by-source": `${I18N}.presetBySource`,
  custom: `${I18N}.presetCustom`,
  overview: `${I18N}.presetOverview`,
  tokens: `${I18N}.presetTokens`,
} as const;

const MEASURE_LABEL = {
  cost: `${I18N}.measureCost`,
  tokens: `${I18N}.measureTokens`,
} as const;

const GROUP_LABEL = {
  model: `${I18N}.groupModel`,
  none: `${I18N}.groupNone`,
  source: `${I18N}.groupSource`,
} as const;

const CHART_LABEL = {
  line: `${I18N}.chartLine`,
  ranking: `${I18N}.chartRanking`,
  stackedBar: `${I18N}.chartStackedBar`,
} as const;

const KPI_LABEL = {
  latestDayTokens: `${I18N}.kpiLatestDayTokens`,
  period: `${I18N}.kpiPeriod`,
  periodTokens: `${I18N}.kpiPeriodTokens`,
  today: `${I18N}.kpiToday`,
} as const;

function chartsForGroupBy(
  groupBy: CostOverviewGroupBy
): readonly CostOverviewChart[] {
  if (groupBy === "model") return ["ranking"];
  if (groupBy === "source") return ["stackedBar"];
  return ["line", "stackedBar"];
}

/**
 * 成本总览物料设置。
 * Field 规范：分区用 FieldLegend；控件旁只用 FieldLabel 一次，禁止 Legend+Label 同文。
 * 短枚举（范围/度量）用 ToggleGroup；长列表用 Select；多选走 Checkbox 组。
 */
export function CostOverviewSettings({
  params,
  updateParams,
}: WorkbenchWidgetSettingsProps) {
  const t = useT();
  const snapshot = useUsageDataStore((state) => state.snapshot);
  const current = useMemo(
    () => parseCostOverviewParams(params as Readonly<Record<string, unknown>>),
    [params]
  );

  const availableSources = snapshot?.sources ?? [];
  const selectedSources = current.sources ?? [];
  const allowedCharts = chartsForGroupBy(current.groupBy);
  const chartLocked = allowedCharts.length <= 1;
  const displayChart = normalizeCostOverviewChart(
    current.groupBy,
    current.chart
  );
  const presetValue =
    current.preset === "custom" ? "custom" : (current.preset ?? "custom");

  const persist = (patch: CostOverviewParamsPatch): void => {
    updateParams(
      costOverviewParamsToJson(patchCostOverviewParams(current, patch))
    );
  };

  const toggleKpi = (kpi: CostOverviewKpiId, checked: boolean): void => {
    if (checked) {
      if (!current.kpis.includes(kpi)) {
        persist({ kpis: [...current.kpis, kpi] });
      }
      return;
    }
    if (current.kpis.length <= 1) return;
    persist({ kpis: current.kpis.filter((id) => id !== kpi) });
  };

  const toggleSource = (sourceId: string, checked: boolean): void => {
    if (checked) {
      if (selectedSources.includes(sourceId)) return;
      const next = [...selectedSources, sourceId];
      const allIds = availableSources.map((source) => source.sourceId);
      if (
        allIds.length > 0 &&
        next.length === allIds.length &&
        allIds.every((id) => next.includes(id))
      ) {
        persist({ sources: undefined });
        return;
      }
      persist({ sources: next });
      return;
    }
    const next = selectedSources.filter((id) => id !== sourceId);
    persist({ sources: next.length > 0 ? next : undefined });
  };

  return (
    <div className="flex flex-col gap-6">
      <FieldSet className="gap-4">
        <FieldLegend className="mb-0" variant="label">
          {t(`${I18N}.sectionView`)}
        </FieldLegend>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="cost-overview-preset">
              {t(`${I18N}.preset`)}
            </FieldLabel>
            <Select
              onValueChange={(next) => {
                if (next === "custom") return;
                persist({ preset: next as (typeof SETTINGS_PRESETS)[number] });
              }}
              value={presetValue}
            >
              <SelectTrigger
                data-testid="cost-overview-settings-preset"
                id="cost-overview-preset"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {SETTINGS_PRESETS.map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {t(PRESET_LABEL[preset])}
                    </SelectItem>
                  ))}
                  {presetValue === "custom" ? (
                    <SelectItem disabled value="custom">
                      {t(PRESET_LABEL.custom)}
                    </SelectItem>
                  ) : null}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel id="cost-overview-range-label">
              {t(`${I18N}.range`)}
            </FieldLabel>
            <ToggleGroup
              aria-labelledby="cost-overview-range-label"
              className="flex-wrap"
              data-testid="cost-overview-settings-range"
              onValueChange={(next) => {
                if (!next) return;
                persist({ rangeDays: Number(next) as CostOverviewRangeDays });
              }}
              size="sm"
              spacing={0}
              type="single"
              value={String(current.rangeDays)}
              variant="outline"
            >
              {RANGE_OPTIONS.map((days) => (
                <ToggleGroupItem key={days} value={String(days)}>
                  {t(`${I18N}.rangeDays`, { count: days })}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <Field>
            <FieldLabel id="cost-overview-measure-label">
              {t(`${I18N}.measure`)}
            </FieldLabel>
            <ToggleGroup
              aria-labelledby="cost-overview-measure-label"
              className="flex-wrap"
              data-testid="cost-overview-settings-measure"
              onValueChange={(next) => {
                if (!next) return;
                persist({ measure: next as CostOverviewMeasure });
              }}
              size="sm"
              spacing={0}
              type="single"
              value={current.measure}
              variant="outline"
            >
              {MEASURE_OPTIONS.map((measure) => (
                <ToggleGroupItem key={measure} value={measure}>
                  {t(MEASURE_LABEL[measure])}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <Field>
            <FieldLabel htmlFor="cost-overview-group-by">
              {t(`${I18N}.groupBy`)}
            </FieldLabel>
            <Select
              onValueChange={(next) => {
                persist({ groupBy: next as CostOverviewGroupBy });
              }}
              value={current.groupBy}
            >
              <SelectTrigger
                data-testid="cost-overview-settings-group-by"
                id="cost-overview-group-by"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {GROUP_BY_OPTIONS.map((groupBy) => (
                    <SelectItem key={groupBy} value={groupBy}>
                      {t(GROUP_LABEL[groupBy])}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="cost-overview-chart">
              {t(`${I18N}.chart`)}
            </FieldLabel>
            <Select
              disabled={chartLocked}
              onValueChange={(next) => {
                persist({ chart: next as CostOverviewChart });
              }}
              value={displayChart}
            >
              <SelectTrigger
                data-testid="cost-overview-settings-chart"
                id="cost-overview-chart"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {allowedCharts.map((chart) => (
                    <SelectItem key={chart} value={chart}>
                      {t(CHART_LABEL[chart])}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {chartLocked ? (
              <FieldDescription>{t(`${I18N}.chartAutoHint`)}</FieldDescription>
            ) : null}
          </Field>
        </FieldGroup>
      </FieldSet>

      <FieldSet className="gap-3">
        <div className="flex flex-col gap-1">
          <FieldLegend className="mb-0" variant="label">
            {t(`${I18N}.kpis`)}
          </FieldLegend>
          <FieldDescription>{t(`${I18N}.kpisHint`)}</FieldDescription>
        </div>
        <FieldGroup className="gap-2" data-slot="checkbox-group">
          {KPI_OPTIONS.map((kpi) => {
            const id = `cost-overview-kpi-${kpi}`;
            return (
              <Field
                className="items-center"
                key={kpi}
                orientation="horizontal"
              >
                <Checkbox
                  checked={current.kpis.includes(kpi)}
                  data-testid={id}
                  id={id}
                  onCheckedChange={(value) => {
                    toggleKpi(kpi, value === true);
                  }}
                />
                <FieldLabel className="font-normal" htmlFor={id}>
                  {t(KPI_LABEL[kpi])}
                </FieldLabel>
              </Field>
            );
          })}
        </FieldGroup>
      </FieldSet>

      {availableSources.length > 0 ? (
        <FieldSet className="gap-3">
          <div className="flex flex-col gap-1">
            <FieldLegend className="mb-0" variant="label">
              {t(`${I18N}.sources`)}
            </FieldLegend>
            <FieldDescription>{t(`${I18N}.sourcesHint`)}</FieldDescription>
          </div>
          <FieldGroup
            className="gap-2"
            data-slot="checkbox-group"
            data-testid="cost-overview-settings-sources"
          >
            {availableSources.map((source) => {
              const id = `cost-overview-source-${source.sourceId}`;
              const label = resolveUsageSourceLabel(
                t,
                source.pluginId,
                source.sourceId
              );
              return (
                <Field
                  className="items-center"
                  key={`${source.pluginId}:${source.sourceId}`}
                  orientation="horizontal"
                >
                  <Checkbox
                    checked={selectedSources.includes(source.sourceId)}
                    data-testid={id}
                    id={id}
                    onCheckedChange={(value) => {
                      toggleSource(source.sourceId, value === true);
                    }}
                  />
                  <FieldLabel className="font-normal" htmlFor={id}>
                    {label}
                  </FieldLabel>
                </Field>
              );
            })}
          </FieldGroup>
        </FieldSet>
      ) : null}
    </div>
  );
}
