import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { DIALOG_COMMIT_FIELD_GROUP_CLASS } from "@pier/ui/dialog-form-layout.ts";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
import { Item, ItemActions, ItemContent, ItemTitle } from "@pier/ui/item.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pier/ui/select.tsx";
import type { JsonValue } from "@shared/contracts/plugin/settings.ts";
import i18next, { type TFunction } from "i18next";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { formatMetricNumber } from "@/lib/workbench/metric-format.ts";
import {
  type MetricDescriptor,
  type MetricValue,
  useMetricValue,
} from "@/lib/workbench/metric-registry.ts";
import { blockAcceptsMetric, type CustomCardBlock } from "./params.ts";

export function moveBlock(
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

export function blocksToJson(blocks: readonly CustomCardBlock[]): JsonValue[] {
  return blocks.map((block) => {
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
}

export function metricPreviewValue(
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

export function MetricPreviewValue({
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

/** 单区块编辑项：Item outline 列表项 chrome。 */
export function EditableBlockRow({
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
  const ordinal = index + 1;

  return (
    <Item
      className="flex-col items-stretch gap-3"
      data-testid={`custom-card-settings-block-${block.id}`}
      size="sm"
      variant="outline"
    >
      <div className="flex w-full items-center gap-2">
        <ItemContent className="min-w-0 flex-1 flex-row items-center gap-2">
          <Badge variant="secondary">{blockTypeLabel}</Badge>
          <ItemTitle className="text-muted-foreground text-xs tabular-nums">
            {t("workbench.widget.customCard.blockOrdinal", {
              n: ordinal,
            })}
          </ItemTitle>
        </ItemContent>
        <ItemActions className="shrink-0">
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
        </ItemActions>
      </div>

      <FieldGroup className={DIALOG_COMMIT_FIELD_GROUP_CLASS}>
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
              className="w-full"
              id={`custom-card-block-metric-${block.id}`}
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
          {currentDescriptor ? (
            <FieldDescription>
              {t(
                `workbench.widget.customCard.metricKind.${currentDescriptor.kind}`
              )}
              {" · "}
              {t(
                `workbench.widget.customCard.metricFormat.${currentDescriptor.format}`
              )}
              {" · "}
              <span className="font-mono tabular-nums">{preview}</span>
            </FieldDescription>
          ) : null}
        </Field>
      </FieldGroup>
    </Item>
  );
}
