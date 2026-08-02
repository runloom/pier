import type {
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type {
  GitReviewFailure,
  GitReviewPathMutationRequest,
  GitReviewScope,
} from "@shared/contracts/git/review.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { z } from "zod";
import { pluginText } from "../plugin-text.ts";
import {
  canDiscardUnstagedStatus,
  type GitDiscardSelection,
  isTrackedDiscardStatus,
  isUntrackedDiscardStatus,
  partitionDiscardPaths,
} from "./discard.ts";
import { gitReviewFailureMessage } from "./message.ts";
import type { GitReviewMutationAuthority } from "./mutation-authority.ts";
import {
  beginGitReviewMutationTransition,
  cancelGitReviewMutationTransition,
  commitGitReviewMutationTransition,
} from "./mutation-transitions.ts";

const reviewTreeItemMetadataSchema = z.object({
  allDiscardTrackedDeleted: z.boolean().default(false),
  contextId: z.string().min(1),
  expectedIndexRevision: z.string().min(1).nullable().default(null),
  gitRootPath: z.string().min(1),
  // stage/unstage/discard 的可见性事实;旧调用方缺省为 false/空。
  hasConflict: z.boolean().default(false),
  hasStaged: z.boolean().default(false),
  hasUnstaged: z.boolean().default(false),
  kind: z.enum(["directory", "file"]),
  mutationBlocked: z.boolean().default(false),
  oldPaths: z.array(z.string().min(1)).default([]),
  /**
   * Tree row path (may include synthetic group root). Expand/collapse uses this.
   * Disk/git path ops must use `repoPath` when present.
   */
  path: z.string().min(1),
  /**
   * Repo-relative path for copy/reveal/open. Absent on synthetic group roots
   * (tree path is only the section label, not a real directory).
   */
  repoPath: z.string().min(1).optional(),
  /** Explicit paths for directory/group bulk ops; file falls back to path+oldPaths. */
  discardPaths: z.array(z.string().min(1)).default([]),
  discardTrackedPaths: z.array(z.string().min(1)).default([]),
  discardUntrackedPaths: z.array(z.string().min(1)).default([]),
  stagePaths: z.array(z.string().min(1)).default([]),
  unstagePaths: z.array(z.string().min(1)).default([]),
  unstagedStatus: z
    .enum(["added", "conflicted", "deleted", "modified", "renamed"])
    .nullable()
    .default(null),
  uncommitted: z.boolean().default(false),
});

export type GitReviewTreeItemMetadata = z.infer<
  typeof reviewTreeItemMetadataSchema
>;

/** Prefer repoPath; file rows historically put the git path in `path`. */
export function reviewTreeItemRepoPath(
  item: Pick<GitReviewTreeItemMetadata, "kind" | "path" | "repoPath">
): string | null {
  if (item.repoPath != null && item.repoPath.length > 0) {
    return item.repoPath;
  }
  // Legacy: file menus stored repo-relative path in `path` without repoPath.
  if (item.kind === "file") {
    return item.path;
  }
  return null;
}

export function parseGitReviewTreeItemMetadata(
  invocation: RendererPluginActionInvocation | undefined
): GitReviewTreeItemMetadata | null {
  const parsed = reviewTreeItemMetadataSchema.safeParse(invocation?.metadata);
  return parsed.success ? parsed.data : null;
}

export function basename(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

export function panelContextFromReviewItem(
  item: GitReviewTreeItemMetadata
): PanelContext {
  return {
    contextId: item.contextId,
    gitRoot: item.gitRootPath,
    projectRootPath: item.gitRootPath,
    source: "panel",
    updatedAt: Date.now(),
  };
}

export function canStage(item: GitReviewTreeItemMetadata | null): boolean {
  if (!isMutableReviewItem(item)) return false;
  if (item.stagePaths.length > 0) return true;
  return (
    item.kind === "file" && (item.hasUnstaged || item.hasConflict === true)
  );
}

export function canUnstage(item: GitReviewTreeItemMetadata | null): boolean {
  if (!isMutableReviewItem(item)) return false;
  if (item.unstagePaths.length > 0) return true;
  return item.kind === "file" && item.hasStaged;
}

/** Tracked modified/deleted + untracked added; rename 仍不提供（语义歧义）。 */
export function canDiscard(item: GitReviewTreeItemMetadata | null): boolean {
  if (!isMutableReviewItem(item)) return false;
  if (
    item.discardTrackedPaths.length > 0 ||
    item.discardUntrackedPaths.length > 0 ||
    item.discardPaths.length > 0
  ) {
    return true;
  }
  return (
    item.kind === "file" &&
    item.hasUnstaged &&
    canDiscardUnstagedStatus(item.unstagedStatus)
  );
}

export function isMutableReviewItem(
  item: GitReviewTreeItemMetadata | null
): item is GitReviewTreeItemMetadata & { expectedIndexRevision: string } {
  return Boolean(
    item?.uncommitted &&
      item.expectedIndexRevision &&
      item.expectedIndexRevision.length > 0
  );
}

export function discardSelectionFromItem(
  item: GitReviewTreeItemMetadata
): GitDiscardSelection {
  if (
    item.discardTrackedPaths.length > 0 ||
    item.discardUntrackedPaths.length > 0
  ) {
    return {
      allTrackedDeleted: item.allDiscardTrackedDeleted,
      trackedPaths: item.discardTrackedPaths,
      untrackedPaths: item.discardUntrackedPaths,
    };
  }
  if (item.discardPaths.length > 0) {
    // Legacy metadata without split: single path uses status; multi assume tracked.
    if (item.discardPaths.length === 1) {
      return partitionDiscardPaths({
        paths: item.discardPaths,
        uniformStatus: item.unstagedStatus,
      });
    }
    return {
      trackedPaths: [...item.discardPaths],
      untrackedPaths: [],
    };
  }
  if (item.kind === "file" && item.hasUnstaged) {
    const repoPath = reviewTreeItemRepoPath(item);
    if (repoPath == null) {
      return { trackedPaths: [], untrackedPaths: [] };
    }
    if (isUntrackedDiscardStatus(item.unstagedStatus)) {
      return { trackedPaths: [], untrackedPaths: [repoPath] };
    }
    if (isTrackedDiscardStatus(item.unstagedStatus)) {
      return {
        allTrackedDeleted: item.unstagedStatus === "deleted",
        trackedPaths: [repoPath],
        untrackedPaths: [],
      };
    }
  }
  return { trackedPaths: [], untrackedPaths: [] };
}

export function stageOperationPaths(item: GitReviewTreeItemMetadata): string[] {
  if (item.stagePaths.length > 0) {
    return [...item.stagePaths];
  }
  const repoPath = reviewTreeItemRepoPath(item);
  if (repoPath == null) {
    return [];
  }
  return [repoPath, ...item.oldPaths.filter((path) => path !== repoPath)];
}

export function unstageOperationPaths(
  item: GitReviewTreeItemMetadata
): string[] {
  if (item.unstagePaths.length > 0) {
    return [...item.unstagePaths];
  }
  const repoPath = reviewTreeItemRepoPath(item);
  if (repoPath == null) {
    return [];
  }
  return [repoPath, ...item.oldPaths.filter((path) => path !== repoPath)];
}

export function treeMutationSource(
  item: GitReviewTreeItemMetadata
): GitReviewScope {
  return {
    contextId: item.contextId,
    gitRootPath: item.gitRootPath,
    target: { kind: "uncommitted" },
  };
}

export async function showTreeMutationFailure(
  context: RendererPluginContext,
  title: string,
  error: GitReviewFailure | unknown
): Promise<void> {
  console.error(title, error);
  let body: string;
  if (
    error !== null &&
    typeof error === "object" &&
    "kind" in error &&
    error.kind === "error"
  ) {
    body = [
      gitReviewFailureMessage(context, error as GitReviewFailure),
      (error as GitReviewFailure).message,
    ]
      .filter(Boolean)
      .join("\n\n");
  } else {
    body = error instanceof Error ? error.message : String(error);
  }
  await context.dialogs.alert({ body, title });
}

export async function runTreePathMutation(options: {
  readonly action: GitReviewPathMutationRequest["action"];
  readonly authority: GitReviewMutationAuthority;
  readonly context: RendererPluginContext;
  readonly item: GitReviewTreeItemMetadata & {
    readonly expectedIndexRevision: string;
  };
  readonly paths: readonly string[];
  readonly title: string;
}): Promise<void> {
  const { action, authority, context, item, paths, title } = options;
  const source = treeMutationSource(item);
  let succeeded = false;
  let succeededStateSequence: number | undefined;
  if (!authority.acquire(source)) {
    context.notifications.error(
      pluginText(
        context,
        "reviewMutationInProgress",
        "Another change is still being applied"
      )
    );
    return;
  }
  // 树右键无控件 busy：loading toast 表示进行中；成功仅 dismiss（列表移动是强反馈）。
  // CodeView 头/hunk 已有 busy/pending，不得再套 loading toast。
  // 文案走 plugin i18n messages["ui.*"]（pluginText 已加 ui. 前缀）。
  const loadingMessage = treePathMutationLoadingMessage(context, action);
  const loading = context.notifications.loading(loadingMessage);
  const transitionId =
    item.kind === "file" && (action === "stage" || action === "unstage")
      ? crypto.randomUUID()
      : null;
  if (transitionId !== null) {
    const transitionPath = reviewTreeItemRepoPath(item) ?? item.path;
    beginGitReviewMutationTransition({
      contextId: item.contextId,
      gitRootPath: item.gitRootPath,
      path: transitionPath,
      targetSurface: action === "stage" ? "staged" : "index",
      transitionId,
    });
  }
  try {
    const result = await context.git.applyReviewPathMutation({
      action,
      expectedIndexRevision: item.expectedIndexRevision,
      operationId: crypto.randomUUID(),
      paths: [...new Set(paths)],
      source,
    });
    if (result.kind === "ok") {
      succeeded = true;
      succeededStateSequence = result.stateSequence;
    } else {
      await showTreeMutationFailure(context, title, result);
    }
  } catch (error) {
    await showTreeMutationFailure(context, title, error);
  } finally {
    loading.dismiss();
    if (transitionId !== null) {
      if (succeeded) {
        commitGitReviewMutationTransition(transitionId, succeededStateSequence);
      } else {
        cancelGitReviewMutationTransition(transitionId);
      }
    }
    // refreshNow 的 Promise 在失败后保持挂起，直到用户显式重试成功；
    // action 本身不占住菜单调用栈，但仓库权限持续保持 blocked。
    authority
      .refreshAndRelease(source)
      .then(() => undefined)
      .catch((error) => {
        console.error(
          "Failed to refresh Git Review after tree mutation.",
          error
        );
      });
  }
}

export function treePathMutationLoadingMessage(
  context: RendererPluginContext,
  action: GitReviewPathMutationRequest["action"]
): string {
  switch (action) {
    case "stage":
      return pluginText(context, "reviewTreeStaging", "Staging…");
    case "unstage":
      return pluginText(context, "reviewTreeUnstaging", "Unstaging…");
    case "revert":
      return pluginText(context, "reviewTreeDiscarding", "Discarding changes…");
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
