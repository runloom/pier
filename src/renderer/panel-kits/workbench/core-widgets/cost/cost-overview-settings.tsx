import { Checkbox } from "@pier/ui/checkbox.tsx";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
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
 * 成本总览设置：桌面工具对话框密度。
 * - 主控件：左标签 / 右控件（对齐设置页 SelectRow）
 * - 短枚举：右簇 ToggleGroup
 * - 多选：Checkbox 横排自动折行，不占整列清单
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
    <FieldSet className="gap-0">
      <FieldGroup className="gap-3">
        <Field className="items-center" orientation="horizontal">
          <FieldContent className="min-w-0">
            <FieldLabel htmlFor="cost-overview-preset">
              {t(`${I18N}.preset`)}
            </FieldLabel>
          </FieldContent>
          <Select
            onValueChange={(next) => {
              if (next === "custom") return;
              persist({ preset: next as (typeof SETTINGS_PRESETS)[number] });
            }}
            value={presetValue}
          >
            <SelectTrigger
              className="w-[11.5rem]"
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

        <Field className="items-center" orientation="horizontal">
          <FieldContent className="min-w-0">
            <FieldLabel id="cost-overview-range-label">
              {t(`${I18N}.range`)}
            </FieldLabel>
          </FieldContent>
          <ToggleGroup
            aria-labelledby="cost-overview-range-label"
            className="shrink-0 justify-end"
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
                {t(`${I18N}.rangeDaysShort`, { count: days })}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>

        <Field className="items-center" orientation="horizontal">
          <FieldContent className="min-w-0">
            <FieldLabel id="cost-overview-measure-label">
              {t(`${I18N}.measure`)}
            </FieldLabel>
          </FieldContent>
          <ToggleGroup
            aria-labelledby="cost-overview-measure-label"
            className="shrink-0 justify-end"
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

        <Field className="items-center" orientation="horizontal">
          <FieldContent className="min-w-0">
            <FieldLabel htmlFor="cost-overview-group-by">
              {t(`${I18N}.groupBy`)}
            </FieldLabel>
          </FieldContent>
          <Select
            onValueChange={(next) => {
              persist({ groupBy: next as CostOverviewGroupBy });
            }}
            value={current.groupBy}
          >
            <SelectTrigger
              className="w-[11.5rem]"
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

        <Field
          className={chartLocked ? "items-start" : "items-center"}
          orientation="horizontal"
        >
          <FieldContent className="min-w-0">
            <FieldLabel htmlFor="cost-overview-chart">
              {t(`${I18N}.chart`)}
            </FieldLabel>
            {chartLocked ? (
              <FieldDescription>{t(`${I18N}.chartAutoHint`)}</FieldDescription>
            ) : null}
          </FieldContent>
          <Select
            disabled={chartLocked}
            onValueChange={(next) => {
              persist({ chart: next as CostOverviewChart });
            }}
            value={displayChart}
          >
            <SelectTrigger
              className="w-[11.5rem]"
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
        </Field>
      </FieldGroup>

      <FieldSeparator className="my-4" />

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <FieldLegend className="mb-0" variant="label">
            {t(`${I18N}.kpis`)}
          </FieldLegend>
          <FieldDescription>{t(`${I18N}.kpisHint`)}</FieldDescription>
        </div>
        <FieldGroup
          className="flex flex-row flex-wrap gap-x-4 gap-y-2"
          data-slot="checkbox-group"
        >
          {KPI_OPTIONS.map((kpi) => {
            const id = `cost-overview-kpi-${kpi}`;
            return (
              <Field
                className="w-auto items-center"
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
      </div>

      {availableSources.length > 0 ? (
        <>
          <FieldSeparator className="my-4" />
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <FieldLegend className="mb-0" variant="label">
                {t(`${I18N}.sources`)}
              </FieldLegend>
              <FieldDescription>{t(`${I18N}.sourcesHint`)}</FieldDescription>
            </div>
            <FieldGroup
              className="flex flex-row flex-wrap gap-x-4 gap-y-2"
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
                    className="w-auto items-center"
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
          </div>
        </>
      ) : null}
    </FieldSet>
  );
}
