import type {
  PierFileTreeContextMenuItem,
  PierFileTreeContextMenuPoint,
} from "@pier/ui/file-tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewFileStatus,
  GitReviewIndexEntry,
} from "@shared/contracts/git-review.ts";
import { useCallback } from "react";
import { GIT_CHANGES_PANEL_ID } from "../manifest.ts";
import { pluginText } from "./git-plugin-text.ts";
import type { GitReviewTreeModel } from "./git-review-tree.tsx";
import { GIT_REVIEW_TREE_ITEM_SURFACE } from "./git-review-tree-actions.ts";
import type { GitReviewTreeFileRef } from "./git-review-tree-section.ts";

export interface GitReviewTreeItemMenuFlags {
  /** Unstaged modified/deleted paths eligible for restore/discard. */
  discardPaths: readonly string[];
  hasConflict: boolean;
  hasStaged: boolean;
  hasUnstaged: boolean;
  /** Repo-relative paths to stage (unstaged only; conflicts excluded). */
  stagePaths: readonly string[];
  unstagedStatus: GitReviewFileStatus | null;
  /** Repo-relative paths to unstage. */
  unstagePaths: readonly string[];
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    out.push(path);
  }
  return out;
}

/** Row-scoped menu facts: fileRef gates half-staged rows; directories aggregate. */
export function buildGitReviewTreeItemMenuFlags(options: {
  entry?: GitReviewIndexEntry;
  fileRef?: GitReviewTreeFileRef;
  /** Directory / group-root: all file refs under the tree path. */
  fileRefs?: readonly GitReviewTreeFileRef[];
}): GitReviewTreeItemMenuFlags {
  const { entry, fileRef, fileRefs } = options;
  if (fileRef) {
    const stagePaths = fileRef.group === "unstaged" ? [fileRef.path] : [];
    const unstagePaths = fileRef.group === "staged" ? [fileRef.path] : [];
    const discardPaths =
      fileRef.group === "unstaged" &&
      (fileRef.status === "modified" || fileRef.status === "deleted")
        ? [fileRef.path]
        : [];
    return {
      discardPaths,
      hasConflict: fileRef.group === "conflict",
      hasStaged: fileRef.group === "staged",
      hasUnstaged: fileRef.group === "unstaged",
      stagePaths,
      unstagePaths,
      unstagedStatus: fileRef.group === "unstaged" ? fileRef.status : null,
    };
  }
  if (fileRefs && fileRefs.length > 0) {
    let hasConflict = false;
    let hasStaged = false;
    let hasUnstaged = false;
    const stagePaths: string[] = [];
    const unstagePaths: string[] = [];
    const discardPaths: string[] = [];
    let unstagedStatus: GitReviewFileStatus | null = null;
    for (const ref of fileRefs) {
      if (ref.group === "conflict") {
        hasConflict = true;
        continue;
      }
      if (ref.group === "staged") {
        hasStaged = true;
        unstagePaths.push(ref.path);
        continue;
      }
      if (ref.group === "unstaged") {
        hasUnstaged = true;
        stagePaths.push(ref.path);
        unstagedStatus ??= ref.status;
        if (ref.status === "modified" || ref.status === "deleted") {
          discardPaths.push(ref.path);
        }
      }
    }
    return {
      discardPaths: uniquePaths(discardPaths),
      hasConflict,
      hasStaged,
      hasUnstaged,
      stagePaths: uniquePaths(stagePaths),
      unstagePaths: uniquePaths(unstagePaths),
      unstagedStatus,
    };
  }
  const slotGroups = entry?.renderSlots.map((slot) => slot.group) ?? [];
  const stagePaths =
    entry?.renderSlots
      .filter((slot) => slot.group === "unstaged")
      .map((slot) => slot.targetPath) ?? [];
  const unstagePaths =
    entry?.renderSlots
      .filter((slot) => slot.group === "staged")
      .map((slot) => slot.targetPath) ?? [];
  const discardPaths =
    entry?.renderSlots
      .filter(
        (slot) =>
          slot.group === "unstaged" &&
          (slot.status === "modified" || slot.status === "deleted")
      )
      .map((slot) => slot.targetPath) ?? [];
  return {
    discardPaths: uniquePaths(discardPaths),
    hasConflict: slotGroups.includes("conflict"),
    hasStaged: slotGroups.includes("staged"),
    hasUnstaged: slotGroups.includes("unstaged"),
    stagePaths: uniquePaths(stagePaths),
    unstagePaths: uniquePaths(unstagePaths),
    unstagedStatus:
      entry?.renderSlots.find((slot) => slot.group === "unstaged")?.status ??
      null,
  };
}

interface GitReviewTreeContextMenuOptions {
  context: RendererPluginContext;
  contextId: string;
  gitRootPath: string;
  sourcePanelId?: string;
  treeModel: GitReviewTreeModel;
}

export function useGitReviewTreeContextMenu({
  context,
  contextId,
  gitRootPath,
  sourcePanelId,
  treeModel,
}: GitReviewTreeContextMenuOptions) {
  return useCallback(
    (
      item: PierFileTreeContextMenuItem,
      point: PierFileTreeContextMenuPoint
    ) => {
      // tree path 带 group 前缀；Open File 必须用真实 git path。
      // 目录/组根：聚合子文件 refs，供 stage/unstage 批量路径。
      const fileRef =
        item.kind === "file"
          ? treeModel.getFileRefForTreePath(item.path)
          : undefined;
      const fileRefs =
        item.kind === "directory"
          ? treeModel.getFileRefsUnderTreePath(item.path)
          : undefined;
      const entry = fileRef
        ? treeModel.entryByKey.get(fileRef.entryKey)
        : undefined;
      const path =
        item.kind === "file" ? (fileRef?.path ?? item.path) : item.path;
      const flags = buildGitReviewTreeItemMenuFlags({
        ...(entry ? { entry } : {}),
        ...(fileRef ? { fileRef } : {}),
        ...(fileRefs ? { fileRefs } : {}),
      });
      // 目录也弹 surface，阻断冒泡到 panel/content 的复制/全选；Open File 仅对文件有意义。
      context.contextMenu
        .popup(GIT_REVIEW_TREE_ITEM_SURFACE, point, {
          metadata: {
            contextId,
            discardPaths: flags.discardPaths,
            gitRootPath,
            hasConflict: flags.hasConflict,
            hasStaged: flags.hasStaged,
            hasUnstaged: flags.hasUnstaged,
            kind: item.kind,
            oldPaths: entry?.oldPaths ?? [],
            path,
            stagePaths: flags.stagePaths,
            unstagePaths: flags.unstagePaths,
            unstagedStatus: flags.unstagedStatus,
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
    [context, contextId, gitRootPath, sourcePanelId, treeModel]
  );
}
