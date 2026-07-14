import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { LayoutDashboard, Plus } from "lucide-react";
import { useT } from "@/i18n/use-t.ts";

interface MissionControlAddCardProps {
  isEmpty: boolean;
  onBrowse: () => void;
}

/** 空画布显示完整空态；已有物料时作为有序网格末尾的 2×1 添加入口。 */
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
    <Empty className="absolute inset-0 p-6" data-testid="mission-control-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LayoutDashboard aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{t("missionControl.empty")}</EmptyTitle>
        <EmptyDescription>
          {t("missionControl.emptyDescription")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
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
