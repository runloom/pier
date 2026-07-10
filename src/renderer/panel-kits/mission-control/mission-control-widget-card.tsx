import { Alert, AlertDescription } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pier/ui/dropdown-menu.tsx";
import { WidgetSkeleton } from "@pier/ui/widget-state.tsx";
import type { MissionControlGridSize } from "@shared/contracts/mission-control.ts";
import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import {
  Copy,
  EllipsisVertical,
  GripVertical,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react";
import { type KeyboardEvent, useId, useMemo, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { showAppConfirm } from "@/stores/app-dialog.store.ts";
import type { ResolvedMissionControlWidget } from "./mission-control-merge.ts";
import { WidgetErrorBoundary } from "./mission-control-widget-error-boundary.tsx";

interface MissionControlWidgetCardProps {
  onDuplicate: () => void;
  onLayoutKeyDown: (
    event: KeyboardEvent<HTMLButtonElement>,
    title: string
  ) => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onRemove: () => void;
  refreshToken: number;
  size: MissionControlGridSize;
  updateParams: (patch: Record<string, JsonValue>) => void;
  visible: boolean;
  widget: ResolvedMissionControlWidget;
}

/** 菜单条目按声明能力位与锁定态过滤；空菜单时整个触发器不渲染。 */
function useMenuFlags(widget: ResolvedMissionControlWidget) {
  const canRefresh =
    widget.refreshable &&
    (widget.status === "core" || widget.status === "plugin-active");
  const canConfigure =
    widget.configurable && widget.registration?.settingsComponent !== undefined;
  return {
    any: true,
    canConfigure,
    canRefresh,
  };
}

const LAYOUT_KEY_SHORTCUTS =
  "ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown";
export function MissionControlWidgetCard({
  onDuplicate,
  onOpenSettings,
  onRefresh,
  onLayoutKeyDown,
  onRemove,
  refreshToken,
  size,
  updateParams,
  visible,
  widget,
}: MissionControlWidgetCardProps) {
  const t = useT();
  const menu = useMenuFlags(widget);
  const [menuOpen, setMenuOpen] = useState(false);
  const layoutInstructionsId = useId();

  const title = useMemo(() => {
    if (widget.status === "core") {
      return t(widget.title);
    }
    return widget.title;
  }, [widget.status, widget.title, t]);

  const description = useMemo(() => {
    if (!widget.description) {
      return;
    }
    if (widget.status === "core") {
      return t(widget.description);
    }
    return widget.description;
  }, [widget.status, widget.description, t]);

  const Icon = widget.registration?.icon;

  const confirmRemove = async (): Promise<void> => {
    const confirmed = await showAppConfirm({
      body: t("missionControl.removeConfirmBody"),
      intent: "destructive",
      size: "sm",
      title: t("missionControl.removeConfirmTitle"),
    });
    if (confirmed) {
      onRemove();
    }
  };

  const renderBody = (): React.ReactNode => {
    if (widget.status === "plugin-disabled") {
      return (
        <div className="flex items-center justify-center p-4 text-muted-foreground text-sm">
          {t("missionControl.widget.pluginDisabled")}
        </div>
      );
    }
    if (widget.status === "unknown") {
      return (
        <Alert className="m-3" variant="destructive">
          <AlertDescription className="flex flex-col items-center gap-2">
            <span>{t("missionControl.widget.unknown")}</span>
            <Button
              data-testid="mission-control-widget-unknown-remove"
              onClick={async () => {
                await confirmRemove();
              }}
              size="xs"
              variant="destructive"
            >
              {t("missionControl.widget.remove")}
            </Button>
          </AlertDescription>
        </Alert>
      );
    }
    if (!widget.registration) {
      return <WidgetSkeleton data-testid="mission-control-widget-loading" />;
    }
    const WidgetComponent = widget.registration.component;
    return (
      <WidgetErrorBoundary
        fallbackMessage={t("missionControl.widget.errorFallback")}
        onRetry={onRefresh}
        resetKey={refreshToken}
        retryLabel={t("missionControl.widget.retry")}
        widgetId={widget.widgetId}
      >
        <WidgetComponent
          instanceId={widget.instanceId}
          params={widget.params}
          refreshToken={refreshToken}
          size={size}
          updateParams={updateParams}
          visible={visible}
        />
      </WidgetErrorBoundary>
    );
  };

  return (
    <Card
      className="group h-full gap-0 rounded-xl py-0 [--card-spacing:--spacing(3)]"
      data-testid={`mission-control-widget-${widget.instanceId}`}
      data-widget-id={widget.widgetId}
    >
      <CardHeader className="select-none items-center gap-0.5 border-border/60 border-b pt-3">
        <CardTitle className="flex items-center gap-1.5 font-semibold text-sm">
          <button
            aria-describedby={layoutInstructionsId}
            aria-keyshortcuts={LAYOUT_KEY_SHORTCUTS}
            aria-label={t("missionControl.widget.layoutHandle", { title })}
            className="mission-control-widget-drag-handle -ml-1 flex size-5 cursor-grab items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground/70 opacity-40 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing group-hover:opacity-100"
            onKeyDown={(event) => {
              if (
                event.key !== "ArrowLeft" &&
                event.key !== "ArrowRight" &&
                event.key !== "ArrowUp" &&
                event.key !== "ArrowDown"
              ) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              onLayoutKeyDown(event, title);
            }}
            type="button"
          >
            <GripVertical aria-hidden="true" className="size-3.5" />
          </button>
          <span className="sr-only" id={layoutInstructionsId}>
            {t("missionControl.widget.layoutInstructions")}
          </span>
          {Icon ? (
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
          {/* 描述不占卡头第二行（挤压内容区），挂 title 提示即可 */}
          <span className="truncate" title={description ?? undefined}>
            {title}
          </span>
        </CardTitle>
        {menu.any ? (
          <CardAction>
            <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={t("missionControl.widget.menu")}
                  className="text-muted-foreground opacity-40 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                  data-testid="mission-control-widget-menu-trigger"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setMenuOpen(true);
                  }}
                  size="icon-xs"
                  variant="ghost"
                >
                  <EllipsisVertical className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {menu.canRefresh ? (
                  <DropdownMenuItem onSelect={onRefresh}>
                    <RefreshCw className="size-4" />
                    {t("missionControl.widget.refresh")}
                  </DropdownMenuItem>
                ) : null}
                {menu.canConfigure ? (
                  <DropdownMenuItem
                    data-testid="mission-control-widget-menu-settings"
                    onSelect={onOpenSettings}
                  >
                    <Settings2 className="size-4" />
                    {t("missionControl.widget.settings")}
                  </DropdownMenuItem>
                ) : null}
                {widget.multiInstance ? (
                  <DropdownMenuItem
                    data-testid="mission-control-widget-menu-duplicate"
                    onSelect={onDuplicate}
                  >
                    <Copy className="size-4" />
                    {t("missionControl.widget.duplicate")}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  data-testid="mission-control-widget-menu-remove"
                  onSelect={async (event) => {
                    event.preventDefault();
                    await confirmRemove();
                  }}
                  variant="destructive"
                >
                  <Trash2 className="size-4" />
                  {t("missionControl.widget.remove")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent
        className="@container min-h-0 flex-1 overflow-y-auto p-0"
        data-scrollbar="stable"
      >
        {renderBody()}
      </CardContent>
    </Card>
  );
}
