import { Button } from "@pier/ui/button.tsx";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pier/ui/select.tsx";
import type { WorkbenchWidgetSettingsProps } from "@plugins/api/renderer.ts";
import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import i18next, { type TFunction } from "i18next";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { ensureCoreMetricsRegistered } from "@/lib/workbench/core-metrics.ts";
import { formatMetricNumber } from "@/lib/workbench/metric-format.ts";
import {
  type MetricDescriptor,
  type MetricValue,
  useMetricDescriptors,
  useMetricValue,
} from "@/lib/workbench/metric-registry.ts";
import {
  blockAcceptsMetric,
  type CustomCardBlock,
  type CustomCardBlockType,
  customCardBlockTypeSchema,
  parseCustomCardParams,
} from "./custom-card-params.ts";

ensureCoreMetricsRegistered();

function moveBlock(
  blocks: readonly CustomCardBlock[],
  index: number,
  delta: -1 | 1
): CustomCardBlock[] {
  const next = [...blocks];
  const target = index + delta;
  const current = next[index];
  const swapped = next[target];
  if (current === undefined || swapped === undefined) {
    return next;
  }
  next[index] = swapped;
  next[target] = current;
  return next;
}

/** 从 MetricValue 抽预览字符串给下拉项展示当前值。 */
function metricPreviewValue(
  value: MetricValue | null,
  format: MetricDescriptor["format"],
  locale: string
): string {
  if (!value) {
    return "—";
  }
  switch (value.kind) {
    case "instant":
      return formatMetricNumber(format, value.value, locale);
    case "grouped":
      return value.items.length === 0
        ? "—"
        : formatMetricNumber(format, value.items.at(0)?.value ?? null, locale);
    case "series": {
      const last = value.points.at(-1);
      return formatMetricNumber(format, last?.value ?? null, locale);
    }
    default:
      return "—";
  }
}

/** 单区块编辑行：label、指标、预览、排序/移除。变更立即持久化。 */
function EditableBlockRow({
  block,
  descriptors,
  index,
  lastIndex,
  onMove,
  onRemove,
  onUpdate,
  t,
}: {
  block: CustomCardBlock;
  descriptors: readonly MetricDescriptor[];
  index: number;
  lastIndex: number;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<Omit<CustomCardBlock, "id" | "type">>) => void;
  t: TFunction;
}) {
  const locale = i18next.language || "en";
  const currentDescriptor = descriptors.find((d) => d.id === block.metricId);
  const value = useMetricValue(block.metricId, true);
  const preview = metricPreviewValue(
    value,
    currentDescriptor?.format ?? "count",
    locale
  );
  const compatibleMetrics = descriptors.filter((d) =>
    blockAcceptsMetric(block.type, d)
  );
  const defaultLabel = currentDescriptor
    ? t(currentDescriptor.titleKey)
    : block.metricId;
  const blockTypeLabel = t(
    `workbench.widget.customCard.blockType.${block.type}`
  );

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/20 p-3"
      data-testid={`custom-card-settings-block-${block.id}`}
    >
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
          {blockTypeLabel}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            aria-label={t("workbench.widget.customCard.moveUp")}
            disabled={index === 0}
            onClick={() => onMove(-1)}
            size="icon-xs"
            variant="ghost"
          >
            <ArrowUp data-icon="inline-start" />
          </Button>
          <Button
            aria-label={t("workbench.widget.customCard.moveDown")}
            disabled={index === lastIndex}
            onClick={() => onMove(1)}
            size="icon-xs"
            variant="ghost"
          >
            <ArrowDown data-icon="inline-start" />
          </Button>
          <Button
            aria-label={t("workbench.widget.customCard.removeBlock")}
            onClick={onRemove}
            size="icon-xs"
            variant="destructive"
          >
            <Trash2 data-icon="inline-start" />
          </Button>
        </div>
      </div>
      <FieldGroup className="gap-2">
        <Field>
          <FieldLabel htmlFor={`custom-card-block-label-${block.id}`}>
            {t("workbench.widget.customCard.labelLabel")}
          </FieldLabel>
          <Input
            id={`custom-card-block-label-${block.id}`}
            onChange={(e) =>
              onUpdate({ label: e.target.value.trim() || undefined })
            }
            placeholder={defaultLabel}
            value={block.label ?? ""}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`custom-card-block-metric-${block.id}`}>
            {t("workbench.widget.customCard.metricLabel")}
          </FieldLabel>
          <Select
            onValueChange={(next) => onUpdate({ metricId: next })}
            value={block.metricId}
          >
            <SelectTrigger
              id={`custom-card-block-metric-${block.id}`}
              size="sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {compatibleMetrics.map((descriptor) => (
                  <SelectItem key={descriptor.id} value={descriptor.id}>
                    {t(descriptor.titleKey)}
                    <MetricPreviewValue
                      descriptorId={descriptor.id}
                      format={descriptor.format}
                      locale={locale}
                    />
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        {currentDescriptor && (
          <div className="flex flex-wrap gap-2 text-muted-foreground text-xs">
            <span>
              {t(
                `workbench.widget.customCard.metricKind.${currentDescriptor.kind}`
              )}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {t(
                `workbench.widget.customCard.metricFormat.${currentDescriptor.format}`
              )}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{preview}</span>
          </div>
        )}
      </FieldGroup>
    </div>
  );
}

/** 指标下拉项里的实时值预览——独立组件以合法地在 map 内订阅 useMetricValue。 */
function MetricPreviewValue({
  descriptorId,
  format,
  locale,
}: {
  descriptorId: string;
  format: MetricDescriptor["format"];
  locale: string;
}) {
  const value = useMetricValue(descriptorId, true);
  return (
    <span className="text-muted-foreground text-xs">
      {metricPreviewValue(value, format, locale)}
    </span>
  );
}

/** 自定义卡片组装器：区块列表（原地编辑 label/指标、排序/删除）+ 添加表单。每次变更立即 updateParams 持久化。 */
export function CustomCardSettings({
  params,
  updateParams,
}: WorkbenchWidgetSettingsProps) {
  const t = useT();
  const locale = i18next.language || "en";
  const blocks = useMemo(() => parseCustomCardParams(params).blocks, [params]);
  const metrics = useMetricDescriptors();

  const [type, setType] = useState<CustomCardBlockType>("kpi");
  const [metricId, setMetricId] = useState("");
  const [label, setLabel] = useState("");

  const compatibleMetrics = useMemo(
    () => metrics.filter((descriptor) => blockAcceptsMetric(type, descriptor)),
    [metrics, type]
  );
  const metricValid = compatibleMetrics.some((d) => d.id === metricId);

  const blockTypeLabel = (blockType: CustomCardBlockType): string =>
    t(`workbench.widget.customCard.blockType.${blockType}`);

  const persistBlocks = (next: CustomCardBlock[]): void => {
    const blocksJson: JsonValue[] = next.map((block) => {
      const jsonBlock: Record<string, JsonValue> = {
        id: block.id,
        metricId: block.metricId,
        type: block.type,
      };
      if (block.label !== undefined) {
        jsonBlock.label = block.label;
      }
      return jsonBlock;
    });
    updateParams({ blocks: blocksJson });
  };

  const updateBlock = (
    blockId: string,
    patch: Partial<Omit<CustomCardBlock, "id" | "type">>
  ): void => {
    persistBlocks(
      blocks.map((b) =>
        b.id === blockId ? { ...b, ...patch, id: b.id, type: b.type } : b
      )
    );
  };

  const handleAdd = (): void => {
    if (!metricValid) {
      return;
    }
    const trimmedLabel = label.trim();
    persistBlocks([
      ...blocks,
      {
        id: crypto.randomUUID(),
        metricId,
        type,
        ...(trimmedLabel ? { label: trimmedLabel } : {}),
      },
    ]);
    setLabel("");
  };

  return (
    <div className="flex flex-col gap-6">
      <FieldSet className="gap-2">
        <FieldLegend className="mb-0" variant="label">
          {t("workbench.widget.customCard.blocksSection")}
        </FieldLegend>
        {blocks.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("workbench.widget.customCard.noBlocks")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {blocks.map((block, index) => (
              <EditableBlockRow
                block={block}
                descriptors={metrics}
                index={index}
                key={block.id}
                lastIndex={blocks.length - 1}
                onMove={(delta) =>
                  persistBlocks(moveBlock(blocks, index, delta))
                }
                onRemove={() =>
                  persistBlocks(blocks.filter((b) => b.id !== block.id))
                }
                onUpdate={(patch) => updateBlock(block.id, patch)}
                t={t}
              />
            ))}
          </div>
        )}
      </FieldSet>

      <FieldSet className="gap-3 rounded-xl border border-border/60 bg-muted/20 p-4">
        <FieldLegend className="mb-0" variant="label">
          {t("workbench.widget.customCard.addSection")}
        </FieldLegend>
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel htmlFor="custom-card-block-type">
              {t("workbench.widget.customCard.blockTypeLabel")}
            </FieldLabel>
            <Select
              onValueChange={(next) => {
                setType(customCardBlockTypeSchema.parse(next));
                setMetricId("");
              }}
              value={type}
            >
              <SelectTrigger id="custom-card-block-type" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {customCardBlockTypeSchema.options.map((option) => (
                    <SelectItem key={option} value={option}>
                      {blockTypeLabel(option)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="custom-card-metric">
              {t("workbench.widget.customCard.metricLabel")}
            </FieldLabel>
            <Select
              onValueChange={setMetricId}
              value={metricValid ? metricId : ""}
            >
              <SelectTrigger
                data-testid="custom-card-settings-metric"
                id="custom-card-metric"
                size="sm"
              >
                <SelectValue
                  placeholder={
                    compatibleMetrics.length === 0
                      ? t("workbench.widget.customCard.noCompatibleMetrics", {
                          type: blockTypeLabel(type),
                        })
                      : t("workbench.widget.customCard.metricPlaceholder")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {compatibleMetrics.map((descriptor) => (
                    <SelectItem key={descriptor.id} value={descriptor.id}>
                      {t(descriptor.titleKey)}
                      <MetricPreviewValue
                        descriptorId={descriptor.id}
                        format={descriptor.format}
                        locale={locale}
                      />
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="custom-card-label">
              {t("workbench.widget.customCard.labelLabel")}
            </FieldLabel>
            <Input
              id="custom-card-label"
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("workbench.widget.customCard.labelPlaceholder")}
              value={label}
            />
          </Field>
          <Button
            className="self-start"
            data-testid="custom-card-settings-add"
            disabled={!metricValid}
            onClick={handleAdd}
            size="sm"
            variant="secondary"
          >
            <Plus data-icon="inline-start" />
            {t("workbench.widget.customCard.addBlock")}
          </Button>
        </FieldGroup>
      </FieldSet>
    </div>
  );
}
