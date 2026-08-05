import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { MouseEvent as ReactMouseEvent } from "react";
import { FILES_FILE_PANEL_ID } from "../../manifest.ts";
import type { FilesDocumentPanelSource } from "../document/types.ts";
import type { FilesTranslate } from "../i18n.ts";

/** 文件面板路径面包屑右键 surface（复制绝对/相对路径）。 */
export const FILES_BREADCRUMB_SURFACE = "files/breadcrumb";

type BreadcrumbContextMenuEvent = ReactMouseEvent<HTMLElement> | MouseEvent;

/**
 * 磁盘源路径 chrome 右键 → 宿主原生菜单（仅 path 类动作）。
 * untitled / 非磁盘源无路径可复制，直接忽略。
 */
export function openFilesBreadcrumbContextMenu(input: {
  context: RendererPluginContext;
  event: BreadcrumbContextMenuEvent;
  panelContext?: PanelContext;
  panelId?: string;
  source: FilesDocumentPanelSource;
  t: FilesTranslate;
}): void {
  const { context, event, panelContext, panelId, source, t } = input;
  if (source.kind !== "disk") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  context.contextMenu
    .popup(
      FILES_BREADCRUMB_SURFACE,
      { x: event.clientX, y: event.clientY },
      {
        metadata: {
          path: source.path,
          root: source.root,
          ...(panelContext?.projectRootPath
            ? { projectRoot: panelContext.projectRootPath }
            : {}),
        },
        sourcePanelComponent: FILES_FILE_PANEL_ID,
        ...(panelContext ? { sourcePanelContext: panelContext } : {}),
        ...(panelId ? { sourcePanelId: panelId } : {}),
      }
    )
    .catch((err: unknown) => {
      context.dialogs
        .alert({
          body: err instanceof Error ? err.message : String(err),
          title: t(
            "filePanel.breadcrumb.contextMenuFailed",
            "Unable to open path menu"
          ),
        })
        .catch(() => undefined);
    });
}

/** 仅磁盘源返回右键 handler；其余 surface 不挂菜单。 */
export function filesBreadcrumbContextMenuHandler(input: {
  context: RendererPluginContext | undefined;
  panelContext?: PanelContext;
  panelId?: string;
  source: FilesDocumentPanelSource | null | undefined;
  t: FilesTranslate;
}): ((event: BreadcrumbContextMenuEvent) => void) | undefined {
  const { context, panelContext, panelId, source, t } = input;
  if (!(context && source) || source.kind !== "disk") {
    return;
  }
  return (event) => {
    openFilesBreadcrumbContextMenu({
      context,
      event,
      panelContext,
      ...(panelId ? { panelId } : {}),
      source,
      t,
    });
  };
}
