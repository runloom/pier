import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pier/ui/dialog.tsx";
import { scrollFadeClassName } from "@pier/ui/scroll-area.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { JsonValue } from "@shared/contracts/plugin/settings.ts";
import { type ReactNode, useCallback, useLayoutEffect, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { useBlockingKeybindingScope } from "@/lib/keybindings/use-blocking-scope.ts";
import type { ResolvedWorkbenchWidget } from "./merge.ts";

const WORKBENCH_SETTINGS_KEYBINDING_SCOPE =
  "overlay:workbench-widget-settings" as const;

interface WorkbenchSettingsDialogProps {
  onOpenChange: (open: boolean) => void;
  updateParams: (patch: Record<string, JsonValue>) => void;
  widget: ResolvedWorkbenchWidget | null;
}

/**
 * 物料设置宿主：Dialog 内嵌物料自带的 settingsComponent。
 * 写回统一走 updateParams（随 panel params 持久化），宿主不解释配置内容。
 *
 * 交互模型 = 即时偏好（改即写）；可选 sticky footer 由 settings 经 setFooter
 * 注册。footer 仅在 dialog 关闭（widget=null）时由宿主清空——不在 instance
 * 切换时 layout 清空，避免与子组件 useContentDialogFooter 竞态（子先 set、
 * 宿主后 null）。
 */
export function WorkbenchSettingsDialog({
  onOpenChange,
  updateParams,
  widget,
}: WorkbenchSettingsDialogProps) {
  const t = useT();
  const [retainedWidget, setRetainedWidget] =
    useState<ResolvedWorkbenchWidget | null>(widget);
  const [footer, setFooterState] = useState<ReactNode | null>(null);

  useLayoutEffect(() => {
    if (widget) {
      setRetainedWidget(widget);
      return;
    }
    // Fully closed: drop footer so exit animation / next open starts clean.
    setFooterState(null);
  }, [widget]);

  const setFooter = useCallback((next: ReactNode | null) => {
    setFooterState(next);
  }, []);

  const presentedWidget = widget ?? retainedWidget;
  const SettingsComponent = presentedWidget?.registration?.settingsComponent;
  let title = "";
  if (presentedWidget !== null) {
    title =
      presentedWidget.status === "core"
        ? t(presentedWidget.title)
        : presentedWidget.title;
  }

  useBlockingKeybindingScope(
    widget !== null,
    WORKBENCH_SETTINGS_KEYBINDING_SCOPE
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={widget !== null}>
      <DialogContent
        className="flex max-h-[min(36rem,calc(100vh-var(--app-titlebar-height)-2rem))] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        closeLabel={t("dialog.close")}
        data-testid="workbench-widget-settings-dialog"
        initialFocus="firstFocusable"
        showCloseButton
      >
        <DialogHeader className="shrink-0 gap-1 border-border/60 border-b px-6 py-4 pr-14">
          <DialogTitle className="text-base leading-none">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("workbench.widget.settingsDescription")}
          </DialogDescription>
        </DialogHeader>
        {presentedWidget && SettingsComponent ? (
          // Native overflow (not Radix ScrollArea): same class as
          // AppContentDialogHost — flex max-h shells clip when ScrollArea's
          // display:table content wrapper fails to bound height (tall custom
          // card block lists, etc.).
          <div
            className={cn(
              "min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-5",
              scrollFadeClassName({ fade: "vertical" })
            )}
            data-scrollbar="overlay"
            data-slot="workbench-widget-settings-body"
          >
            <SettingsComponent
              instanceId={presentedWidget.instanceId}
              params={presentedWidget.params}
              setFooter={setFooter}
              updateParams={updateParams}
            />
          </div>
        ) : null}
        {footer ? (
          <DialogFooter
            className="shrink-0 border-border/60 border-t px-6 py-4"
            data-testid="workbench-widget-settings-footer"
          >
            {footer}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
