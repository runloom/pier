import type {
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type {
  GitReviewFailure,
  GitReviewPathMutationRequest,
  GitReviewScope,
} from "@shared/contracts/git-review.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { FileText, Minus, Plus, Undo2 } from "lucide-react";
import { z } from "zod";
import { pluginText } from "./git-plugin-text.ts";
import {
  canDiscardUnstagedStatus,
  confirmGitDiscard,
  type GitDiscardSelection,
  isTrackedDiscardStatus,
  isUntrackedDiscardStatus,
  partitionDiscardPaths,
} from "./git-review-discard.ts";
import { gitReviewFailureMessage } from "./git-review-message.ts";
import { GitReviewMutationAuthority } from "./git-review-mutation-authority.ts";
import {
  beginGitReviewMutationTransition,
  cancelGitReviewMutationTransition,
  commitGitReviewMutationTransition,
} from "./git-review-mutation-transitions.ts";

export const GIT_REVIEW_TREE_ITEM_SURFACE = "git/review-tree-item";
export const GIT_REVIEW_OPEN_FILE_COMMAND_ID = "pier.git.review.openFile";
export const GIT_REVIEW_STAGE_FILE_COMMAND_ID = "pier.git.review.stageFile";
export const GIT_REVIEW_UNSTAGE_FILE_COMMAND_ID = "pier.git.review.unstageFile";
export const GIT_REVIEW_DISCARD_FILE_COMMAND_ID = "pier.git.review.discardFile";

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
  path: z.string().min(1),
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

export function parseGitReviewTreeItemMetadata(
  invocation: RendererPluginActionInvocation | undefined
): GitReviewTreeItemMetadata | null {
  const parsed = reviewTreeItemMetadataSchema.safeParse(invocation?.metadata);
  return parsed.success ? parsed.data : null;
}

function basename(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

function panelContextFromReviewItem(
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

function canStage(item: GitReviewTreeItemMetadata | null): boolean {
  if (!isMutableReviewItem(item)) {
    return false;
  }
  if (item.stagePaths.length > 0) {
    return true;
  }
  return (
    item.kind === "file" && (item.hasUnstaged || item.hasConflict === true)
  );
}

function canUnstage(item: GitReviewTreeItemMetadata | null): boolean {
  if (!isMutableReviewItem(item)) {
    return false;
  }
  if (item.unstagePaths.length > 0) {
    return true;
  }
  return item.kind === "file" && item.hasStaged;
}

/** Tracked modified/deleted + untracked added; rename 仍不提供（语义歧义）。 */
function canDiscard(item: GitReviewTreeItemMetadata | null): boolean {
  if (!isMutableReviewItem(item)) {
    return false;
  }
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

function isMutableReviewItem(
  item: GitReviewTreeItemMetadata | null
): item is GitReviewTreeItemMetadata & { expectedIndexRevision: string } {
  return Boolean(
    item?.uncommitted &&
      item.expectedIndexRevision &&
      item.expectedIndexRevision.length > 0
  );
}

function discardSelectionFromItem(
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
    if (isUntrackedDiscardStatus(item.unstagedStatus)) {
      return { trackedPaths: [], untrackedPaths: [item.path] };
    }
    if (isTrackedDiscardStatus(item.unstagedStatus)) {
      return {
        allTrackedDeleted: item.unstagedStatus === "deleted",
        trackedPaths: [item.path],
        untrackedPaths: [],
      };
    }
  }
  return { trackedPaths: [], untrackedPaths: [] };
}

function stageOperationPaths(item: GitReviewTreeItemMetadata): string[] {
  if (item.stagePaths.length > 0) {
    return [...item.stagePaths];
  }
  return [item.path, ...item.oldPaths.filter((path) => path !== item.path)];
}

function unstageOperationPaths(item: GitReviewTreeItemMetadata): string[] {
  if (item.unstagePaths.length > 0) {
    return [...item.unstagePaths];
  }
  return [item.path, ...item.oldPaths.filter((path) => path !== item.path)];
}

function treeMutationSource(item: GitReviewTreeItemMetadata): GitReviewScope {
  return {
    contextId: item.contextId,
    gitRootPath: item.gitRootPath,
    target: { kind: "uncommitted" },
  };
}

async function showTreeMutationFailure(
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

async function runTreePathMutation(options: {
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
  const transitionId =
    item.kind === "file" && (action === "stage" || action === "unstage")
      ? crypto.randomUUID()
      : null;
  if (transitionId !== null) {
    beginGitReviewMutationTransition({
      contextId: item.contextId,
      gitRootPath: item.gitRootPath,
      path: item.path,
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

export function registerGitReviewTreeActions(
  context: RendererPluginContext,
  authority = new GitReviewMutationAuthority()
): () => void {
  const disposers = [
    context.actions.register({
      category: "Git",
      enabled: () => true,
      handler: (invocation) => {
        const item = parseGitReviewTreeItemMetadata(invocation);
        if (item?.kind !== "file") {
          return;
        }
        const opened = context.files.openInEditor({
          context: panelContextFromReviewItem(item),
          path: item.path,
          root: item.gitRootPath,
          title: basename(item.path),
        });
        if (!opened) {
          context.notifications.error(
            pluginText(
              context,
              "reviewTreeOpenFileFailed",
              "Unable to open file"
            )
          );
        }
      },
      id: GIT_REVIEW_OPEN_FILE_COMMAND_ID,
      metadata: {
        categoryKey: "git",
        // Single group: Open / Stage / Unstage / Discard with no separators.
        group: "1_review",
        iconComponent: FileText,
        menuHidden: (invocation) => {
          const item = parseGitReviewTreeItemMetadata(invocation);
          return item?.kind !== "file";
        },
        sortOrder: 0,
      },
      surfaces: [GIT_REVIEW_TREE_ITEM_SURFACE],
      title: () => pluginText(context, "reviewTreeOpenFile", "Open File"),
    }),
    context.actions.register({
      category: "Git",
      enabled: (invocation) => {
        const item = parseGitReviewTreeItemMetadata(invocation);
        return item?.mutationBlocked !== true && canStage(item);
      },
      handler: async (invocation) => {
        const item = parseGitReviewTreeItemMetadata(invocation);
        if (!(isMutableReviewItem(item) && canStage(item))) {
          return;
        }
        await runTreePathMutation({
          action: "stage",
          authority,
          context,
          item,
          paths: stageOperationPaths(item),
          title: pluginText(
            context,
            "reviewTreeStageFailed",
            "Unable to Stage"
          ),
        });
      },
      id: GIT_REVIEW_STAGE_FILE_COMMAND_ID,
      metadata: {
        categoryKey: "git",
        group: "1_review",
        iconComponent: Plus,
        menuHidden: (invocation) =>
          !canStage(parseGitReviewTreeItemMetadata(invocation)),
        sortOrder: 10,
      },
      surfaces: [GIT_REVIEW_TREE_ITEM_SURFACE],
      title: () => pluginText(context, "reviewTreeStageFile", "Stage"),
    }),
    context.actions.register({
      category: "Git",
      enabled: (invocation) => {
        const item = parseGitReviewTreeItemMetadata(invocation);
        return item?.mutationBlocked !== true && canUnstage(item);
      },
      handler: async (invocation) => {
        const item = parseGitReviewTreeItemMetadata(invocation);
        if (!(isMutableReviewItem(item) && canUnstage(item))) {
          return;
        }
        await runTreePathMutation({
          action: "unstage",
          authority,
          context,
          item,
          paths: unstageOperationPaths(item),
          title: pluginText(
            context,
            "reviewTreeUnstageFailed",
            "Unable to Unstage"
          ),
        });
      },
      id: GIT_REVIEW_UNSTAGE_FILE_COMMAND_ID,
      metadata: {
        categoryKey: "git",
        group: "1_review",
        iconComponent: Minus,
        menuHidden: (invocation) =>
          !canUnstage(parseGitReviewTreeItemMetadata(invocation)),
        sortOrder: 11,
      },
      surfaces: [GIT_REVIEW_TREE_ITEM_SURFACE],
      title: () => pluginText(context, "reviewTreeUnstageFile", "Unstage"),
    }),
    context.actions.register({
      category: "Git",
      enabled: (invocation) => {
        const item = parseGitReviewTreeItemMetadata(invocation);
        return item?.mutationBlocked !== true && canDiscard(item);
      },
      handler: async (invocation) => {
        const item = parseGitReviewTreeItemMetadata(invocation);
        if (!(isMutableReviewItem(item) && canDiscard(item))) {
          return;
        }
        const decision = await confirmGitDiscard(
          context,
          discardSelectionFromItem(item)
        );
        if (decision.kind !== "proceed" || decision.paths.length === 0) {
          return;
        }
        await runTreePathMutation({
          action: "revert",
          authority,
          context,
          item,
          paths: decision.paths,
          title: pluginText(
            context,
            "reviewDiscardFailed",
            "Unable to discard changes"
          ),
        });
      },
      id: GIT_REVIEW_DISCARD_FILE_COMMAND_ID,
      metadata: {
        categoryKey: "git",
        group: "1_review",
        iconComponent: Undo2,
        menuHidden: (invocation) =>
          !canDiscard(parseGitReviewTreeItemMetadata(invocation)),
        sortOrder: 20,
      },
      surfaces: [GIT_REVIEW_TREE_ITEM_SURFACE],
      title: () =>
        pluginText(context, "reviewTreeDiscardFile", "Discard Changes"),
    }),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
