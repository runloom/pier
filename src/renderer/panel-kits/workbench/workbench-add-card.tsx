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

interface WorkbenchAddCardProps {
  isEmpty: boolean;
  onBrowse: () => void;
}

/** 空画布显示完整空态；已有物料时作为有序网格末尾的 2×1 添加入口。 */
export function WorkbenchAddCard({ isEmpty, onBrowse }: WorkbenchAddCardProps) {
  const t = useT();

  const card = (
    <button
      className="flex size-full min-h-20 flex-col items-center justify-center gap-2 rounded-xl border border-border/60 border-dashed text-muted-foreground text-sm transition-colors hover:border-border hover:bg-accent/40 hover:text-foreground"
      data-testid="workbench-add-widget"
      onClick={onBrowse}
      type="button"
    >
      <Plus className="size-5" />
      <span>{t("workbench.addWidget")}</span>
    </button>
  );

  if (!isEmpty) return card;

  return (
    <Empty className="absolute inset-0 p-6" data-testid="workbench-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LayoutDashboard aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{t("workbench.empty")}</EmptyTitle>
        <EmptyDescription>{t("workbench.emptyDescription")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          data-testid="workbench-add-widget"
          onClick={onBrowse}
          type="button"
        >
          <Plus data-icon="inline-start" />
          {t("workbench.addWidget")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
