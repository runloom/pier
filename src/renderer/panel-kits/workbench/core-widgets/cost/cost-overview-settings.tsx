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
  type CostOverviewParamsPatch,
  type CostOverviewPresetId,
  type CostOverviewRangeDays,
  costOverviewParamsToJson,
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

const PRESET_LABEL = {
  "by-model": `${I18N}.presetByModel`,
  "by-source": `${I18N}.presetBySource`,
  custom: `${I18N}.presetCustom`,
  overview: `${I18N}.presetOverview`,
  tokens: `${I18N}.presetTokens`,
} as const;

/**
 * 成本总览设置：只暴露用户真正需要的三项——
 * 1. 视图（总览 / 按来源 / 按模型 / Tokens）
 * 2. 时间范围
 * 3. 来源筛选（有多来源时才出现）
 *
 * measure / groupBy / chart / KPI 由视图预设决定，不再单独暴露。
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
  const presetValue =
    current.preset === "custom" ? "custom" : (current.preset ?? "overview");

  const persist = (patch: CostOverviewParamsPatch): void => {
    updateParams(
      costOverviewParamsToJson(patchCostOverviewParams(current, patch))
    );
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
              {t(`${I18N}.view`)}
            </FieldLabel>
            <FieldDescription>{t(`${I18N}.viewHint`)}</FieldDescription>
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
      </FieldGroup>

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
