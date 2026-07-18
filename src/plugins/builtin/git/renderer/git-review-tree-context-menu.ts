import type {
  PierFileTreeContextMenuItem,
  PierFileTreeContextMenuPoint,
} from "@pier/ui/file-tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useCallback } from "react";
import { GIT_CHANGES_PANEL_ID } from "../manifest.ts";
import { pluginText } from "./git-plugin-text.ts";
import { GIT_REVIEW_TREE_ITEM_SURFACE } from "./git-review-tree-actions.ts";

interface GitReviewTreeContextMenuOptions {
  context: RendererPluginContext;
  contextId: string;
  gitRootPath: string;
  sourcePanelId?: string;
}

export function useGitReviewTreeContextMenu({
  context,
  contextId,
  gitRootPath,
  sourcePanelId,
}: GitReviewTreeContextMenuOptions) {
  return useCallback(
    (
      item: PierFileTreeContextMenuItem,
      point: PierFileTreeContextMenuPoint
    ) => {
      // 目录也弹 surface，阻断冒泡到 panel/content 的复制/全选；Open File 仅对文件有意义。
      context.contextMenu
        .popup(GIT_REVIEW_TREE_ITEM_SURFACE, point, {
          metadata: {
            contextId,
            gitRootPath,
            kind: item.kind,
            path: item.path,
          },
          sourcePanelComponent: GIT_CHANGES_PANEL_ID,
          ...(sourcePanelId ? { sourcePanelId } : {}),
        })
        .catch((error: unknown) => {
          const title = pluginText(
            context,
            "reviewTreeContextMenuFailed",
            "Unable to open menu"
          );
          if (error instanceof Error) {
            context.dialogs
              .alert({ body: error.message, size: "default", title })
              .catch(() => undefined);
            return;
          }
          context.notifications.error(title);
        });
    },
    [context, contextId, gitRootPath, sourcePanelId]
  );
}
