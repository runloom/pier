import { Button } from "@pier/ui/button.tsx";
import { LayoutGrid, Lock, LockOpen, Plus, RefreshCw } from "lucide-react";
import { useT } from "@/i18n/use-t.ts";

interface MissionControlToolbarProps {
  canArrange: boolean;
  locked: boolean;
  onAdd: () => void;
  onArrange: () => void;
  onRefreshAll: () => void;
  onToggleLocked: () => void;
}

export function MissionControlToolbar({
  canArrange,
  locked,
  onAdd,
  onArrange,
  onRefreshAll,
  onToggleLocked,
}: MissionControlToolbarProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 border-border/60 border-b px-3 py-2">
      {locked ? (
        <div
          className="rounded-md bg-muted/60 px-2.5 py-1.5 text-muted-foreground text-xs"
          data-testid="mission-control-locked-banner"
        >
          {t("missionControl.lockedBanner")}
        </div>
      ) : null}
      <div
        className="flex flex-wrap items-center gap-1"
        data-testid="mission-control-toolbar"
      >
        <Button
          data-testid="mission-control-toolbar-add"
          disabled={locked}
          onClick={onAdd}
          size="xs"
          type="button"
          variant="outline"
        >
          <Plus className="size-3.5" />
          {t("missionControl.toolbar.add")}
        </Button>
        <Button
          data-testid="mission-control-toolbar-refresh-all"
          onClick={onRefreshAll}
          size="xs"
          type="button"
          variant="ghost"
        >
          <RefreshCw className="size-3.5" />
          {t("missionControl.toolbar.refreshAll")}
        </Button>
        <Button
          data-testid="mission-control-toolbar-arrange"
          disabled={locked || !canArrange}
          onClick={onArrange}
          size="xs"
          type="button"
          variant="ghost"
        >
          <LayoutGrid className="size-3.5" />
          {t("missionControl.toolbar.arrangeLayout")}
        </Button>
        <Button
          aria-pressed={locked}
          data-testid="mission-control-toolbar-lock"
          onClick={onToggleLocked}
          size="xs"
          type="button"
          variant={locked ? "default" : "ghost"}
        >
          {locked ? (
            <LockOpen className="size-3.5" />
          ) : (
            <Lock className="size-3.5" />
          )}
          {locked
            ? t("missionControl.toolbar.unlock")
            : t("missionControl.toolbar.lock")}
        </Button>
      </div>
    </div>
  );
}
