import {
  collectionAutoFitClassName,
  collectionAutoFitStyle,
  widgetDensityFor,
  widgetShellClassName,
} from "@pier/ui/collection-auto-layout.ts";
import { WidgetEmpty } from "@pier/ui/widget-state.tsx";
import type { WorkbenchWidgetComponentProps } from "@plugins/api/renderer.ts";
import { Blocks, Settings } from "lucide-react";
import { useMemo } from "react";
import { useT } from "@/i18n/use-t.ts";
import { ensureCoreMetricsRegistered } from "@/lib/workbench/core-metrics.ts";
import { CustomCardBlockView } from "./custom-card-blocks.tsx";
import {
  blockVisibleAtDensity,
  groupBlocks,
  parseCustomCardParams,
} from "./custom-card-params.ts";

/**
 * 自定义卡片的轻量块组（kpi/gauge）auto-fit min-width。
 * 略小于成本总览的 KPI min-width（6.5rem）以适配更窄的自定义卡片实例。
 */
const COMPACT_GROUP_MIN_WIDTH = "5.5rem";

ensureCoreMetricsRegistered();

/** 自定义卡片物料：用户在设置面板组装"区块 × 指标"，params 随 panel params 持久化。多实例。 */
export function CustomCardWidget({
  params,
  size,
  visible,
}: WorkbenchWidgetComponentProps) {
  const t = useT();
  const density = widgetDensityFor(size);
  const parsed = useMemo(() => parseCustomCardParams(params), [params]);

  const visibleBlocks = useMemo(
    () => parsed.blocks.filter((b) => blockVisibleAtDensity(b.type, density)),
    [parsed.blocks, density]
  );

  const groups = useMemo(() => groupBlocks(visibleBlocks), [visibleBlocks]);
  const firstKpiBlockId = useMemo(() => {
    const first = visibleBlocks.find((b) => b.type === "kpi");
    return first?.id;
  }, [visibleBlocks]);

  const hasBlocks = parsed.blocks.length > 0;
  const hasVisibleBlocks = visibleBlocks.length > 0;

  if (!hasBlocks) {
    return (
      <WidgetEmpty
        hint={t("workbench.widget.customCard.emptyHint")}
        icon={Blocks}
        title={t("workbench.widget.customCard.empty")}
      />
    );
  }

  if (!hasVisibleBlocks) {
    return (
      <WidgetEmpty
        hint={t("workbench.widget.customCard.allBlocksHiddenHint", {
          density: t(`workbench.widget.customCard.density.${density}`),
        })}
        icon={Settings}
        title={t("workbench.widget.customCard.allBlocksHidden")}
      />
    );
  }

  return (
    <div
      className={widgetShellClassName(density)}
      data-density={density}
      data-size-h={size.h}
      data-size-w={size.w}
      data-testid="custom-card-content"
    >
      {groups.map((group, gi) => {
        if (group.kind === "full") {
          return (
            <div
              className="min-w-0 shrink-0"
              data-testid={`custom-card-full-${group.block.type}-${gi}`}
              key={group.block.id}
            >
              <CustomCardBlockView
                block={group.block}
                density={density}
                height={size.h}
                visible={visible}
              />
            </div>
          );
        }
        const count = group.blocks.length;
        const single = count === 1;
        return (
          <div
            className={collectionAutoFitClassName(count, {
              singleAs: "block",
              gapClassName: density === "compact" ? "gap-2" : "gap-3",
            })}
            data-layout={single ? "single" : "auto-fit"}
            data-testid={`custom-card-compact-group-${gi}`}
            key={`group-${group.blocks[0]?.id ?? gi}`}
            style={collectionAutoFitStyle(count, COMPACT_GROUP_MIN_WIDTH)}
          >
            {group.blocks.map((block) => (
              <CustomCardBlockView
                block={block}
                density={density}
                height={size.h}
                isPrimary={block.id === firstKpiBlockId}
                key={block.id}
                visible={visible}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
