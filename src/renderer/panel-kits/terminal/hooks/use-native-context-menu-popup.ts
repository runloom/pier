import type { PanelContext } from "@shared/contracts/panel.ts";
import type { IDockviewPanelProps } from "dockview-react";
import { useEffect } from "react";
import { popupContextMenuAt } from "@/lib/context-menu/use-menu.ts";
import { requestTerminalPresentation } from "../presentation-reconciler.ts";

/**
 * Live terminal native right-click → popup `terminal/content` with selection metadata.
 */
export function useNativeTerminalContextMenuPopup(options: {
  readonly api: IDockviewPanelProps["api"];
  readonly effectiveContext: PanelContext | null | undefined;
  readonly panelId: string;
}): void {
  const { api, effectiveContext, panelId } = options;
  useEffect(() => {
    const unsubscribe = window.pier?.terminal?.onContextMenuRequest?.((req) => {
      if (req.panelId !== panelId) {
        return;
      }
      api.setActive();
      requestTerminalPresentation("dockview-active-panel");
      const popupMenu = async (): Promise<void> => {
        let selectedText = "";
        try {
          const selection =
            await window.pier.terminal.readSelectionText(panelId);
          if (selection.kind === "ok") {
            selectedText = selection.text;
          }
        } catch {
          // 选区读取失败时仍弹菜单，Copy 会保持 disabled。
        }
        const linkUrl = req.linkUrl?.trim() ?? "";
        await popupContextMenuAt(
          "terminal/content",
          { x: req.x, y: req.y },
          {
            metadata: {
              ...(selectedText.length > 0 ? { selectedText } : {}),
              ...(linkUrl.length > 0 ? { linkUrl } : {}),
            },
            sourcePanelComponent: "terminal",
            ...(effectiveContext
              ? { sourcePanelContext: effectiveContext }
              : {}),
            ...(typeof api.group?.id === "string"
              ? { sourcePanelGroupId: api.group.id }
              : {}),
            sourcePanelId: panelId,
          }
        );
      };
      popupMenu().catch((err: unknown) => {
        console.error(`[terminal-panel] popup ${req.panelId} failed:`, err);
      });
    });
    return () => {
      unsubscribe?.();
    };
  }, [panelId, api, effectiveContext]);
}
