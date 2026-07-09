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
  locked?: boolean;
  onBrowse: () => void;
  showAction?: boolean;
}

/**
 * 添加物料入口：空态 = 居中引导；非空 = 网格空位上的幽灵虚线卡。
 * 两者都指向物料库对话框。
 */
export function MissionControlAddCard({
  isEmpty,
  locked = false,
  onBrowse,
  showAction = true,
}: MissionControlAddCardProps) {
  const t = useT();

  if (isEmpty) {
    const showAddAction = showAction && !locked;
    return (
      <div className="flex h-full min-h-48 items-center justify-center pb-16">
        <Empty className="border-0 py-8" data-testid="mission-control-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutDashboard />
            </EmptyMedia>
            <EmptyTitle>
              {locked
                ? t("missionControl.lockedEmpty")
                : t("missionControl.empty")}
            </EmptyTitle>
            <EmptyDescription>
              {locked
                ? t("missionControl.lockedEmptyDescription")
                : t("missionControl.emptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
          {showAddAction ? (
            <EmptyContent>
              <Button
                data-testid="mission-control-add-widget"
                onClick={onBrowse}
                size="sm"
                variant="outline"
              >
                <Plus className="mr-1.5 size-4" />
                {t("missionControl.addWidget")}
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      </div>
    );
  }

  // 非空布局的底部添加入口：与真实卡片同圆角，尺寸由调用方按网格自动计算。
  return (
    <button
      className="flex size-full flex-col items-center justify-center gap-2 rounded-xl border border-border/60 border-dashed text-muted-foreground text-sm transition-colors hover:border-border hover:bg-accent/40 hover:text-foreground"
      data-testid="mission-control-add-widget"
      onClick={onBrowse}
      type="button"
    >
      <Plus className="size-5" />
      <span>{t("missionControl.addWidget")}</span>
    </button>
  );
}
