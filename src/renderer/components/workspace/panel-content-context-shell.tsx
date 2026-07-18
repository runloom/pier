import type { IDockviewPanelProps } from "dockview-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
} from "react";
import { PANEL_CONTENT_SURFACE } from "@/lib/context-menu/build-entries.ts";
import { captureDomSelectionText } from "@/lib/context-menu/selection-text.ts";
import { popupContextMenuAt } from "@/lib/context-menu/use-context-menu.ts";
import { cssPointToContentViewPoint } from "@/lib/window-zoom/coordinates.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

/**
 * 所有 web panel 内容区的兜底右键：弹出共享 panel/content 布局菜单。
 * 子树若已 preventDefault + stopPropagation（terminal 走 native、files/workbench
 * 自管菜单），本壳不接管；那些 surface 通过 expandContextMenuSurfaces 并入布局项。
 */
export function PanelContentContextShell({
  api,
  children,
  component,
}: {
  api: IDockviewPanelProps["api"];
  children: ReactNode;
  component: string;
}) {
  const panelId = api.id;
  const groupId = typeof api.group?.id === "string" ? api.group.id : undefined;
  const onContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) {
        return;
      }
      // 先抓选区再 preventDefault。不要在弹菜单前 setActive：
      // 激活切换会冲掉 Pierre 行选区高亮。
      const selectedText = captureDomSelectionText();
      event.preventDefault();
      event.stopPropagation();
      const descriptor =
        usePanelDescriptorStore.getState().descriptors[panelId];
      const coords = cssPointToContentViewPoint(
        { x: event.clientX, y: event.clientY },
        useZoomStore.getState().windowZoomLevel
      );
      popupContextMenuAt(PANEL_CONTENT_SURFACE, coords, {
        sourcePanelComponent: component,
        ...(selectedText.length > 0 ? { metadata: { selectedText } } : {}),
        ...(descriptor?.context
          ? { sourcePanelContext: descriptor.context }
          : {}),
        ...(groupId ? { sourcePanelGroupId: groupId } : {}),
        sourcePanelId: panelId,
      }).catch((err: unknown) => {
        console.error(
          `[panel-content] popup ${PANEL_CONTENT_SURFACE} for ${panelId} failed:`,
          err
        );
      });
    },
    [component, groupId, panelId]
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: panel content root is the layout-menu hit target
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: context menu only; keyboard path stays with focused content
    <div
      className="h-full min-h-0 w-full min-w-0"
      onContextMenu={onContextMenu}
    >
      {children}
    </div>
  );
}
