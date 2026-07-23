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
  type CostOverviewParams,
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
  overview: `${I18N}.presetOverview`,
  "by-source": `${I18N}.presetBySource`,
  "by-model": `${I18N}.presetByModel`,
  tokens: `${I18N}.presetTokens`,
  custom: `${I18N}.presetCustom`,
} as const;

const MEASURE_LABEL = {
  cost: `${I18N}.measureCost`,
  tokens: `${I18N}.measureTokens`,
} as const;

const GROUP_LABEL = {
  none: `${I18N}.groupNone`,
  source: `${I18N}.groupSource`,
  model: `${I18N}.groupModel`,
} as const;

const CHART_LABEL = {
  stackedBar: `${I18N}.chartStackedBar`,
  line: `${I18N}.chartLine`,
  ranking: `${I18N}.chartRanking`,
} as const;

const KPI_LABEL = {
  today: `${I18N}.kpiToday`,
  period: `${I18N}.kpiPeriod`,
  periodTokens: `${I18N}.kpiPeriodTokens`,
  latestDayTokens: `${I18N}.kpiLatestDayTokens`,
} as const;

function chartsForGroupBy(
  groupBy: CostOverviewGroupBy
): readonly CostOverviewChart[] {
  if (groupBy === "source") return ["stackedBar"];
  if (groupBy === "model") return ["ranking"];
  return ["line", "stackedBar"];
}

function SettingsSelect({
  disabled,
  id,
  label,
  onValueChange,
  options,
  testId,
  value,
}: {
  disabled?: boolean;
  id: string;
  label: string;
  onValueChange: (value: string) => void;
  options: readonly { disabled?: boolean; label: string; value: string }[];
  testId: string;
  value: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        disabled={disabled === true}
        onValueChange={onValueChange}
        value={value}
      >
        <SelectTrigger data-testid={testId} id={id} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem
                disabled={option.disabled === true}
                key={option.value}
                value={option.value}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}

/**
 * 成本总览物料设置：预设 + 范围/度量/分组/图表/KPI + 来源过滤。
 * 每次变更即时 updateParams；列表即反馈，不加 toast。
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
  // Empty allowlist = no filter (all sources). Checkboxes stay unchecked.

  const allowedCharts = chartsForGroupBy(current.groupBy);
  const chartLocked = allowedCharts.length <= 1;
  const displayChart = normalizeCostOverviewChart(
    current.groupBy,
    current.chart
  );
  const presetValue =
    current.preset === "custom" ? "custom" : (current.preset ?? "custom");

  const persist = (patch: Partial<CostOverviewParams>): void => {
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
      // Selecting every available source collapses back to "all".
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

  const presetOptions = [
    ...SETTINGS_PRESETS.map((preset) => ({
      label: t(PRESET_LABEL[preset]),
      value: preset,
    })),
    ...(presetValue === "custom"
      ? [
          {
            disabled: true,
            label: t(PRESET_LABEL.custom),
            value: "custom" as const,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <FieldSet className="gap-3">
        <FieldLegend className="mb-0" variant="label">
          {t(`${I18N}.preset`)}
        </FieldLegend>
        <FieldGroup className="gap-3">
          <SettingsSelect
            id="cost-overview-preset"
            label={t(`${I18N}.preset`)}
            onValueChange={(next) => {
              if (next === "custom") return;
              persist({ preset: next as (typeof SETTINGS_PRESETS)[number] });
            }}
            options={presetOptions}
            testId="cost-overview-settings-preset"
            value={presetValue}
          />
        </FieldGroup>
      </FieldSet>

      <FieldSet className="gap-3">
        <FieldLegend className="mb-0" variant="label">
          {t(`${I18N}.range`)}
        </FieldLegend>
        <FieldGroup className="gap-3">
          <SettingsSelect
            id="cost-overview-range"
            label={t(`${I18N}.range`)}
            onValueChange={(next) => {
              persist({ rangeDays: Number(next) as CostOverviewRangeDays });
            }}
            options={RANGE_OPTIONS.map((days) => ({
              label: t(`${I18N}.rangeDays`, { count: days }),
              value: String(days),
            }))}
            testId="cost-overview-settings-range"
            value={String(current.rangeDays)}
          />
          <SettingsSelect
            id="cost-overview-measure"
            label={t(`${I18N}.measure`)}
            onValueChange={(next) => {
              persist({ measure: next as CostOverviewMeasure });
            }}
            options={MEASURE_OPTIONS.map((measure) => ({
              label: t(MEASURE_LABEL[measure]),
              value: measure,
            }))}
            testId="cost-overview-settings-measure"
            value={current.measure}
          />
          <SettingsSelect
            id="cost-overview-group-by"
            label={t(`${I18N}.groupBy`)}
            onValueChange={(next) => {
              persist({ groupBy: next as CostOverviewGroupBy });
            }}
            options={GROUP_BY_OPTIONS.map((groupBy) => ({
              label: t(GROUP_LABEL[groupBy]),
              value: groupBy,
            }))}
            testId="cost-overview-settings-group-by"
            value={current.groupBy}
          />
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

      {availableSources.length > 0 ? (
        <FieldSet className="gap-3">
          <FieldLegend className="mb-0" variant="label">
            {t(`${I18N}.sources`)}
          </FieldLegend>
          <FieldDescription>{t(`${I18N}.sourcesAll`)}</FieldDescription>
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
              const checked = selectedSources.includes(source.sourceId);
              return (
                <Field
                  className="items-center"
                  key={`${source.pluginId}:${source.sourceId}`}
                  orientation="horizontal"
                >
                  <Checkbox
                    checked={checked}
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

      <FieldSet className="gap-3">
        <FieldLegend className="mb-0" variant="label">
          {t(`${I18N}.kpis`)}
        </FieldLegend>
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
    </div>
  );
}
