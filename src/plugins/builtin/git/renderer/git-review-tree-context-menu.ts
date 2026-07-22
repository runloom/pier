import type {
  PierFileTreeContextMenuItem,
  PierFileTreeContextMenuPoint,
} from "@pier/ui/file-tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewIndexEntry } from "@shared/contracts/git-review.ts";
import { useCallback } from "react";
import { GIT_CHANGES_PANEL_ID } from "../manifest.ts";
import { pluginText } from "./git-plugin-text.ts";
import { GIT_REVIEW_TREE_ITEM_SURFACE } from "./git-review-tree-actions.ts";

interface GitReviewTreeContextMenuOptions {
  context: RendererPluginContext;
  contextId: string;
  entryByPath: ReadonlyMap<string, GitReviewIndexEntry>;
  gitRootPath: string;
  sourcePanelId?: string;
}

export function useGitReviewTreeContextMenu({
  context,
  contextId,
  entryByPath,
  gitRootPath,
  sourcePanelId,
}: GitReviewTreeContextMenuOptions) {
  return useCallback(
    (
      item: PierFileTreeContextMenuItem,
      point: PierFileTreeContextMenuPoint
    ) => {
      // displayPath 可能是碰撞合成路径；Open File 必须用真实 entry.path。
      const entry = entryByPath.get(item.path);
      const path =
        item.kind === "file" ? (entry?.path ?? item.path) : item.path;
      const slotGroups = entry?.renderSlots.map((slot) => slot.group) ?? [];
      const unstagedStatus =
        entry?.renderSlots.find((slot) => slot.group === "unstaged")?.status ??
        null;
      // 目录也弹 surface，阻断冒泡到 panel/content 的复制/全选；Open File 仅对文件有意义。
      context.contextMenu
        .popup(GIT_REVIEW_TREE_ITEM_SURFACE, point, {
          metadata: {
            contextId,
            gitRootPath,
            hasConflict: slotGroups.includes("conflict"),
            hasStaged: slotGroups.includes("staged"),
            hasUnstaged: slotGroups.includes("unstaged"),
            kind: item.kind,
            oldPaths: entry?.oldPaths ?? [],
            path,
            unstagedStatus,
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
              .alert({ body: error.message, title })
              .catch(() => undefined);
            return;
          }
          context.notifications.error(title);
        });
    },
    [context, contextId, entryByPath, gitRootPath, sourcePanelId]
  );
}
