import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
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

  if (!isEmpty) return card;

  return (
    <Empty className="size-full gap-1 p-1" data-testid="mission-control-empty">
      <EmptyHeader className="gap-0">
        <EmptyTitle>{t("missionControl.empty")}</EmptyTitle>
      </EmptyHeader>
      <EmptyContent className="gap-0">
        <Button
          data-testid="mission-control-add-widget"
          onClick={onBrowse}
          type="button"
        >
          <Plus data-icon="inline-start" />
          {t("missionControl.addWidget")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
