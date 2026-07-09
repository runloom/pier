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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pier/ui/select.tsx";
import type { MissionControlWidgetSettingsProps } from "@plugins/api/renderer.ts";
import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { ensureCoreMetricsRegistered } from "@/lib/mission-control/core-metrics.ts";
import { useMetricDescriptors } from "@/lib/mission-control/metric-registry.ts";
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

function BlockRow({
  block,
  index,
  lastIndex,
  onMove,
  onRemove,
  subtitle,
  t,
  title,
}: {
  block: CustomCardBlock;
  index: number;
  lastIndex: number;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  subtitle: string;
  t: (key: string) => string;
  title: string;
}) {
  return (
    <div
      className="group/block flex items-center gap-1 rounded-xl border border-border/60 bg-muted/20 py-1.5 pr-1.5 pl-3"
      data-testid={`custom-card-settings-block-${block.id}`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{title}</p>
        <p className="truncate text-muted-foreground text-xs">{subtitle}</p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/block:opacity-100">
        <Button
          aria-label={t("missionControl.widget.customCard.moveUp")}
          disabled={index === 0}
          onClick={() => onMove(-1)}
          size="icon-xs"
          variant="ghost"
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <Button
          aria-label={t("missionControl.widget.customCard.moveDown")}
          disabled={index === lastIndex}
          onClick={() => onMove(1)}
          size="icon-xs"
          variant="ghost"
        >
          <ArrowDown className="size-3.5" />
        </Button>
        <Button
          aria-label={t("missionControl.widget.customCard.removeBlock")}
          className="text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          size="icon-xs"
          variant="ghost"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

/**
 * 自定义卡片的组装器：区块列表（排序/删除）+ 添加表单（块型 → 兼容指标 → 可选标签）。
 * 表单结构走 Field primitives（对齐设置弹窗的表单规范）；
 * 每次变更立即 updateParams 持久化——列表本身就是强自然反馈，不加 toast。
 */
export function CustomCardSettings({
  params,
  updateParams,
}: MissionControlWidgetSettingsProps) {
  const t = useT();
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
    t(`missionControl.widget.customCard.blockType.${blockType}`);

  const metricTitle = (id: string): string => {
    const descriptor = metrics.find((d) => d.id === id);
    return descriptor ? t(descriptor.titleKey) : id;
  };

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
          {t("missionControl.widget.customCard.blocksSection")}
        </FieldLegend>
        {blocks.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("missionControl.widget.customCard.noBlocks")}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {blocks.map((block, index) => (
              <BlockRow
                block={block}
                index={index}
                key={block.id}
                lastIndex={blocks.length - 1}
                onMove={(delta) =>
                  persistBlocks(moveBlock(blocks, index, delta))
                }
                onRemove={() =>
                  persistBlocks(blocks.filter((b) => b.id !== block.id))
                }
                subtitle={`${blockTypeLabel(block.type)} · ${metricTitle(block.metricId)}`}
                t={t}
                title={block.label ?? metricTitle(block.metricId)}
              />
            ))}
          </div>
        )}
      </FieldSet>

      <FieldSet className="gap-3 rounded-xl border border-border/60 bg-muted/20 p-4">
        <FieldLegend className="mb-0" variant="label">
          {t("missionControl.widget.customCard.addSection")}
        </FieldLegend>
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel htmlFor="custom-card-block-type">
              {t("missionControl.widget.customCard.blockTypeLabel")}
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
                {customCardBlockTypeSchema.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {blockTypeLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="custom-card-metric">
              {t("missionControl.widget.customCard.metricLabel")}
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
                  placeholder={t(
                    "missionControl.widget.customCard.metricPlaceholder"
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {compatibleMetrics.map((descriptor) => (
                  <SelectItem key={descriptor.id} value={descriptor.id}>
                    {t(descriptor.titleKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="custom-card-label">
              {t("missionControl.widget.customCard.labelLabel")}
            </FieldLabel>
            <Input
              className="h-8"
              id="custom-card-label"
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t(
                "missionControl.widget.customCard.labelPlaceholder"
              )}
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
            <Plus className="mr-1 size-3.5" />
            {t("missionControl.widget.customCard.addBlock")}
          </Button>
        </FieldGroup>
      </FieldSet>
    </div>
  );
}
