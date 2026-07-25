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
import type { ResolvedWorkbenchWidget } from "./workbench-merge.ts";

interface WorkbenchSettingsDialogProps {
  onOpenChange: (open: boolean) => void;
  updateParams: (patch: Record<string, JsonValue>) => void;
  widget: ResolvedWorkbenchWidget | null;
}

/**
 * 物料设置宿主：Dialog 内嵌物料自带的 settingsComponent。
 * 写回统一走 updateParams（随 panel params 持久化），宿主不解释配置内容。
 *
 * 密度对齐桌面工具对话框：紧凑 Header（单行标题 + 说明仅 a11y）、
 * 中等宽度、body 可滚；不与全页设置/物料库的大 Header 同规格。
 */
export function WorkbenchSettingsDialog({
  onOpenChange,
  updateParams,
  widget,
}: WorkbenchSettingsDialogProps) {
  const t = useT();
  const [retainedWidget, setRetainedWidget] =
    useState<ResolvedWorkbenchWidget | null>(widget);

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
        className="max-h-[min(36rem,calc(100vh-var(--app-titlebar-height)-2rem))] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-lg"
        closeLabel={t("dialog.close")}
        data-testid="workbench-widget-settings-dialog"
        initialFocus="firstFocusable"
        showCloseButton
      >
        <DialogHeader className="gap-1 border-border/60 border-b px-5 py-3.5 pr-12">
          <DialogTitle className="text-base leading-none">{title}</DialogTitle>
          {/* 持久化说明对视线噪音大，保留给读屏；正文区才是配置面。 */}
          <DialogDescription className="sr-only">
            {t("workbench.widget.settingsDescription")}
          </DialogDescription>
        </DialogHeader>
        {presentedWidget && SettingsComponent ? (
          <div
            className="min-h-0 overflow-y-auto px-5 py-4"
            data-scrollbar="stable"
          >
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
