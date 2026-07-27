import { Checkbox } from "@pier/ui/checkbox.tsx";
import {
  DIALOG_COMMIT_FIELD_GROUP_CLASS,
  DIALOG_COMMIT_FORM_CLASS,
  DIALOG_SECTION_TITLE_CLASS,
} from "@pier/ui/dialog-form-layout.ts";
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
 * 成本总览设置：即时写 params，但字段布局对齐提交型 dialog 表单
 * （垂直 Label → 全宽控件 → Description），与新建 worktree / SSH host 同节奏。
 * measure / groupBy / chart 由视图预设决定，不单独暴露。
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
    <div
      className={DIALOG_COMMIT_FORM_CLASS}
      data-slot="workbench-live-preference-form"
    >
      <FieldGroup className={DIALOG_COMMIT_FIELD_GROUP_CLASS}>
        <Field>
          <FieldLabel htmlFor="cost-overview-preset">
            {t(`${I18N}.view`)}
          </FieldLabel>
          <Select
            onValueChange={(next) => {
              if (next === "custom") return;
              persist({ preset: next as (typeof SETTINGS_PRESETS)[number] });
            }}
            value={presetValue}
          >
            <SelectTrigger
              className="w-full"
              data-testid="cost-overview-settings-preset"
              id="cost-overview-preset"
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
          <FieldDescription>{t(`${I18N}.viewHint`)}</FieldDescription>
        </Field>

        <Field>
          <FieldLabel id="cost-overview-range-label">
            {t(`${I18N}.range`)}
          </FieldLabel>
          {/* 分段选项按内容收缩，不铺满整行（避免三段被拉成等宽条）。 */}
          <ToggleGroup
            aria-labelledby="cost-overview-range-label"
            className="w-fit max-w-full justify-start"
            data-testid="cost-overview-settings-range"
            onValueChange={(next) => {
              if (!next) return;
              persist({ rangeDays: Number(next) as CostOverviewRangeDays });
            }}
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
        <FieldSet className="gap-3">
          <div className="flex flex-col gap-1">
            <FieldLegend className={DIALOG_SECTION_TITLE_CLASS} variant="label">
              {t(`${I18N}.sources`)}
            </FieldLegend>
            <FieldDescription>{t(`${I18N}.sourcesHint`)}</FieldDescription>
          </div>
          {/* 多选标签横排换行：来源短、项多时竖排浪费高度。 */}
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
        </FieldSet>
      ) : null}
    </div>
  );
}
