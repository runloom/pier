import type {
  PierFileTreeContextMenuItem,
  PierFileTreeContextMenuPoint,
} from "@pier/ui/file/tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewFileStatus,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { useCallback } from "react";
import { GIT_CHANGES_PANEL_ID } from "../../manifest.ts";
import { pluginText } from "../plugin-text.ts";
import { panelContextFromReviewGitRoot } from "./context/from-git-root.ts";
import type { GitReviewTreeFileRef } from "./tree/section.ts";
import type { GitReviewTreeModel } from "./tree.tsx";
import { GIT_REVIEW_TREE_ITEM_SURFACE } from "./tree-actions.ts";

export interface GitReviewTreeItemMenuFlags {
  /** True when every tracked discard path is a deleted working-tree file. */
  allDiscardTrackedDeleted: boolean;
  /**
   * Unstaged paths eligible for discard (tracked modified/deleted + untracked
   * added). Prefer tracked/untracked split when building confirm dialogs.
   */
  discardPaths: readonly string[];
  /** Unstaged modified/deleted (git restore). */
  discardTrackedPaths: readonly string[];
  /** Unstaged added / untracked (trash or git clean). */
  discardUntrackedPaths: readonly string[];
  hasConflict: boolean;
  hasStaged: boolean;
  hasUnstaged: boolean;
  /** Repo-relative paths to stage (unstaged only; conflicts excluded). */
  stagePaths: readonly string[];
  unstagedStatus: GitReviewFileStatus | null;
  /** Repo-relative paths to unstage. */
  unstagePaths: readonly string[];
}

function isDiscardTrackedStatus(status: GitReviewFileStatus): boolean {
  return status === "modified" || status === "deleted";
}

function isDiscardUntrackedStatus(status: GitReviewFileStatus): boolean {
  return status === "added";
}

function packDiscardFlags(
  tracked: readonly string[],
  untracked: readonly string[],
  allDiscardTrackedDeleted: boolean
): Pick<
  GitReviewTreeItemMenuFlags,
  | "allDiscardTrackedDeleted"
  | "discardPaths"
  | "discardTrackedPaths"
  | "discardUntrackedPaths"
> {
  const discardTrackedPaths = uniquePaths(tracked);
  const discardUntrackedPaths = uniquePaths(untracked);
  return {
    allDiscardTrackedDeleted:
      discardTrackedPaths.length > 0 && allDiscardTrackedDeleted,
    discardPaths: uniquePaths([
      ...discardTrackedPaths,
      ...discardUntrackedPaths,
    ]),
    discardTrackedPaths,
    discardUntrackedPaths,
  };
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
    const tracked =
      fileRef.group === "unstaged" && isDiscardTrackedStatus(fileRef.status)
        ? [fileRef.path]
        : [];
    const untracked =
      fileRef.group === "unstaged" && isDiscardUntrackedStatus(fileRef.status)
        ? [fileRef.path]
        : [];
    return {
      ...packDiscardFlags(
        tracked,
        untracked,
        tracked.length > 0 && fileRef.status === "deleted"
      ),
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
    const discardTrackedPaths: string[] = [];
    const discardUntrackedPaths: string[] = [];
    let trackedDeletedCount = 0;
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
        if (isDiscardTrackedStatus(ref.status)) {
          discardTrackedPaths.push(ref.path);
          if (ref.status === "deleted") {
            trackedDeletedCount += 1;
          }
        } else if (isDiscardUntrackedStatus(ref.status)) {
          discardUntrackedPaths.push(ref.path);
        }
      }
    }
    return {
      ...packDiscardFlags(
        discardTrackedPaths,
        discardUntrackedPaths,
        discardTrackedPaths.length > 0 &&
          trackedDeletedCount === discardTrackedPaths.length
      ),
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
  const trackedSlots =
    entry?.renderSlots.filter(
      (slot) => slot.group === "unstaged" && isDiscardTrackedStatus(slot.status)
    ) ?? [];
  const discardTrackedPaths = trackedSlots.map((slot) => slot.targetPath);
  const discardUntrackedPaths =
    entry?.renderSlots
      .filter(
        (slot) =>
          slot.group === "unstaged" && isDiscardUntrackedStatus(slot.status)
      )
      .map((slot) => slot.targetPath) ?? [];
  const allDiscardTrackedDeleted =
    trackedSlots.length > 0 &&
    trackedSlots.every((slot) => slot.status === "deleted");
  return {
    ...packDiscardFlags(
      discardTrackedPaths,
      discardUntrackedPaths,
      allDiscardTrackedDeleted
    ),
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
  mutationAuthorityBlocked: boolean;
  sourcePanelContext?: PanelContext | null;
  sourcePanelId?: string;
  treeModel: GitReviewTreeModel;
}

export function useGitReviewTreeContextMenu({
  context,
  contextId,
  gitRootPath,
  mutationAuthorityBlocked,
  sourcePanelContext,
  sourcePanelId,
  treeModel,
}: GitReviewTreeContextMenuOptions) {
  return useCallback(
    (
      item: PierFileTreeContextMenuItem,
      point: PierFileTreeContextMenuPoint
    ): Promise<void> => {
      // tree path 带 group 前缀（Changed Files / Changes / …）。
      // path 保留树路径供 expand/collapse；repoPath 才是磁盘/git 相对路径。
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
      const repoPath = treeModel.getRepoRelativePath(item.path);
      const flags = buildGitReviewTreeItemMenuFlags({
        ...(entry ? { entry } : {}),
        ...(fileRef ? { fileRef } : {}),
        ...(fileRefs ? { fileRefs } : {}),
      });
      // 目录也弹 surface，阻断冒泡到 panel/content 的复制/全选；Open File 仅对文件有意义。
      // 返回 Promise：PierFileTree 在菜单关闭后把 focus 还回右键行。
      return context.contextMenu
        .popup(GIT_REVIEW_TREE_ITEM_SURFACE, point, {
          metadata: {
            allDiscardTrackedDeleted: flags.allDiscardTrackedDeleted,
            contextId,
            discardPaths: flags.discardPaths,
            discardTrackedPaths: flags.discardTrackedPaths,
            discardUntrackedPaths: flags.discardUntrackedPaths,
            expectedIndexRevision: treeModel.mutation.expectedIndexRevision,
            gitRootPath,
            hasConflict: flags.hasConflict,
            hasStaged: flags.hasStaged,
            hasUnstaged: flags.hasUnstaged,
            kind: item.kind,
            mutationBlocked: mutationAuthorityBlocked,
            oldPaths: entry?.oldPaths ?? [],
            // Tree path (with group root) so expand/collapse targets the row.
            path: item.path,
            // Repo-relative for copy/reveal/open; omitted on synthetic group roots.
            ...(repoPath == null ? {} : { repoPath }),
            stagePaths: flags.stagePaths,
            unstagePaths: flags.unstagePaths,
            unstagedStatus: flags.unstagedStatus,
            uncommitted: treeModel.mutation.uncommitted,
          },
          sourcePanelComponent: GIT_CHANGES_PANEL_ID,
          sourcePanelContext: panelContextFromReviewGitRoot({
            contextId,
            gitRootPath,
            ...(sourcePanelContext ? { sourcePanelContext } : {}),
          }),
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
    [
      context,
      contextId,
      gitRootPath,
      mutationAuthorityBlocked,
      sourcePanelContext,
      sourcePanelId,
      treeModel,
    ]
  );
}
