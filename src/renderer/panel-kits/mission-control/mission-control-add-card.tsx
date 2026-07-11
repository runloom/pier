import { Empty } from "@pier/ui/empty.tsx";
import { Plus } from "lucide-react";
import { useT } from "@/i18n/use-t.ts";

interface MissionControlAddCardProps {
  isEmpty: boolean;
  onBrowse: () => void;
}

/** 响应式 2×1 添加入口；作为有序网格的最后一个伪条目参与排布。 */
export function MissionControlAddCard({
  isEmpty,
  onBrowse,
}: MissionControlAddCardProps) {
  const t = useT();

  const card = (
    <button
      className="flex size-full min-h-20 flex-col items-center justify-center gap-2 rounded-xl border border-border/60 border-dashed text-muted-foreground text-sm transition-colors hover:border-border hover:bg-accent/40 hover:text-foreground"
      data-testid="mission-control-add-widget"
      onClick={onBrowse}
      type="button"
    >
      <Plus className="size-5" />
      <span>{t("missionControl.addWidget")}</span>
    </button>
  );

  return isEmpty ? (
    <Empty className="size-full p-0" data-testid="mission-control-empty">
      {card}
    </Empty>
  ) : (
    card
  );
}
