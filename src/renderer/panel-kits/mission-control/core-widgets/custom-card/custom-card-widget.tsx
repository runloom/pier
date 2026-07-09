import { WidgetEmpty } from "@pier/ui/widget-state.tsx";
import type { MissionControlWidgetComponentProps } from "@plugins/api/renderer.ts";
import { Blocks } from "lucide-react";
import { useMemo } from "react";
import { useT } from "@/i18n/use-t.ts";
import { ensureCoreMetricsRegistered } from "@/lib/mission-control/core-metrics.ts";
import { CustomCardBlockView } from "./custom-card-blocks.tsx";
import { parseCustomCardParams } from "./custom-card-params.ts";

ensureCoreMetricsRegistered();

/**
 * 自定义卡片物料：用户在设置面板里组装"区块 × 指标"，
 * params 随 panel params 持久化。多实例——每个实例一份独立组装。
 */
export function CustomCardWidget({
  params,
  visible,
}: MissionControlWidgetComponentProps) {
  const t = useT();
  const parsed = useMemo(() => parseCustomCardParams(params), [params]);

  if (parsed.blocks.length === 0) {
    return (
      <WidgetEmpty
        hint={t("missionControl.widget.customCard.emptyHint")}
        icon={Blocks}
        title={t("missionControl.widget.customCard.empty")}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-2 p-3">
      {parsed.blocks.map((block) => (
        <CustomCardBlockView block={block} key={block.id} visible={visible} />
      ))}
    </div>
  );
}
