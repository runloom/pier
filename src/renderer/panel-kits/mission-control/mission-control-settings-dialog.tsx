import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@pier/ui/dialog.tsx";
import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import { useLayoutEffect, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import type { ResolvedMissionControlWidget } from "./mission-control-merge.ts";

interface MissionControlSettingsDialogProps {
  onOpenChange: (open: boolean) => void;
  updateParams: (patch: Record<string, JsonValue>) => void;
  widget: ResolvedMissionControlWidget | null;
}

/**
 * 物料设置宿主：Dialog 内嵌物料自带的 settingsComponent。
 * 写回统一走 updateParams（随 panel params 持久化），宿主不解释配置内容。
 */
export function MissionControlSettingsDialog({
  onOpenChange,
  updateParams,
  widget,
}: MissionControlSettingsDialogProps) {
  const t = useT();
  const [retainedWidget, setRetainedWidget] =
    useState<ResolvedMissionControlWidget | null>(widget);

  useLayoutEffect(() => {
    if (widget) {
      setRetainedWidget(widget);
    }
  }, [widget]);

  const presentedWidget = widget ?? retainedWidget;
  const SettingsComponent = presentedWidget?.registration?.settingsComponent;
  let title = "";
  if (presentedWidget !== null) {
    title =
      presentedWidget.status === "core"
        ? t(presentedWidget.title)
        : presentedWidget.title;
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={widget !== null}>
      <DialogContent
        className="max-h-[calc(100vh-var(--app-titlebar-height)-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-2xl"
        closeLabel={t("dialog.close")}
        data-testid="mission-control-widget-settings-dialog"
        initialFocus="firstFocusable"
        showCloseButton
      >
        <DialogHeader className="border-border/60 border-b px-6 py-5 pr-14">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {t("missionControl.widget.settingsDescription")}
          </DialogDescription>
        </DialogHeader>
        {presentedWidget && SettingsComponent ? (
          <div className="min-h-0 overflow-y-auto p-6" data-scrollbar="stable">
            <SettingsComponent
              instanceId={presentedWidget.instanceId}
              params={presentedWidget.params}
              updateParams={updateParams}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
