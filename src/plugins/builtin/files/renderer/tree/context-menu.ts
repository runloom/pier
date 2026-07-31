import type {
  PierFileTreeContextMenuItem,
  PierFileTreeContextMenuPoint,
} from "@pier/ui/file/tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import { type MouseEvent as ReactMouseEvent, useCallback } from "react";
import { FILES_FILE_PANEL_ID } from "../../manifest.ts";
import type { FilesTranslate } from "../i18n.ts";
import { extractItemPathFromEvent } from "./sidebar-helpers.ts";

interface FilesTreeContextMenuOptions {
  context: RendererPluginContext;
  entriesByPath: ReadonlyMap<string, FileEntry>;
  instanceId: string;
  /** 可选；与 root 不同时供「复制相对路径」相对项目根。 */
  projectRoot?: string;
  root: string;
  selectedPathsRef: { readonly current: readonly string[] };
  /** dockview panel id；group 共享树时与 instanceId(groupId) 不同。 */
  sourcePanelId?: string;
  t: FilesTranslate;
}

export function useFilesTreeContextMenus({
  context,
  entriesByPath,
  instanceId,
  projectRoot,
  root,
  sourcePanelId,
  selectedPathsRef,
  t,
}: FilesTreeContextMenuOptions) {
  const reportFailure = useCallback(
    (error: unknown) => {
      const title = t(
        "filePanel.tree.contextMenuFailed",
        "Unable to open menu"
      );
      if (error instanceof Error) {
        context.dialogs
          .alert({ body: error.message, title })
          .catch(() => undefined);
        return;
      }
      context.notifications.error(title);
    },
    [context, t]
  );

  const openItemContextMenu = useCallback(
    (
      item: PierFileTreeContextMenuItem,
      point: PierFileTreeContextMenuPoint
    ) => {
      const entry = entriesByPath.get(item.path);
      if (!entry) {
        return;
      }
      const selection = selectedPathsRef.current;
      const selectedPaths =
        selection.length > 1 && selection.includes(entry.path)
          ? [...selection]
          : undefined;
      const entryKinds: Record<string, "directory" | "file"> = {
        [entry.path]: entry.kind,
      };
      if (selectedPaths) {
        for (const path of selectedPaths) {
          const selected = entriesByPath.get(path);
          if (selected) {
            entryKinds[path] = selected.kind;
          }
        }
      }
      // sourcePanelId 必须是 dockview panel id，不能用 tree registry key(groupId)。
      context.contextMenu
        .popup("files/tree-item", point, {
          metadata: {
            entryKinds,
            kind: entry.kind,
            path: entry.path,
            root: entry.root,
            treeId: instanceId,
            ...(projectRoot ? { projectRoot } : {}),
            ...(selectedPaths ? { selectedPaths } : {}),
          },
          sourcePanelComponent: FILES_FILE_PANEL_ID,
          ...(sourcePanelId ? { sourcePanelId } : {}),
        })
        .catch(reportFailure);
    },
    [
      context,
      entriesByPath,
      instanceId,
      projectRoot,
      reportFailure,
      selectedPathsRef,
      sourcePanelId,
    ]
  );

  const openBackgroundContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (
        event.defaultPrevented ||
        extractItemPathFromEvent(event.nativeEvent) !== null
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      context.contextMenu
        .popup(
          "files/tree-background",
          { x: event.clientX, y: event.clientY },
          {
            metadata: { root, treeId: instanceId },
            sourcePanelComponent: FILES_FILE_PANEL_ID,
            ...(sourcePanelId ? { sourcePanelId } : {}),
          }
        )
        .catch(reportFailure);
    },
    [context, instanceId, reportFailure, root, sourcePanelId]
  );

  return { openBackgroundContextMenu, openItemContextMenu };
}
