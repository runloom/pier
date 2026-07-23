import type {
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { FileText, Minus, Plus, Undo2 } from "lucide-react";
import { z } from "zod";
import { confirmDialog, notifyError } from "./git-command-helpers.ts";
import { pluginText } from "./git-plugin-text.ts";

export const GIT_REVIEW_TREE_ITEM_SURFACE = "git/review-tree-item";
export const GIT_REVIEW_OPEN_FILE_COMMAND_ID = "pier.git.review.openFile";
export const GIT_REVIEW_STAGE_FILE_COMMAND_ID = "pier.git.review.stageFile";
export const GIT_REVIEW_UNSTAGE_FILE_COMMAND_ID = "pier.git.review.unstageFile";
export const GIT_REVIEW_DISCARD_FILE_COMMAND_ID = "pier.git.review.discardFile";

const reviewTreeItemMetadataSchema = z.object({
  contextId: z.string().min(1),
  gitRootPath: z.string().min(1),
  // stage/unstage/discard 的可见性事实;旧调用方缺省为 false/空。
  hasConflict: z.boolean().default(false),
  hasStaged: z.boolean().default(false),
  hasUnstaged: z.boolean().default(false),
  kind: z.enum(["directory", "file"]),
  oldPaths: z.array(z.string().min(1)).default([]),
  path: z.string().min(1),
  /** Explicit paths for directory/group bulk ops; file falls back to path+oldPaths. */
  discardPaths: z.array(z.string().min(1)).default([]),
  stagePaths: z.array(z.string().min(1)).default([]),
  unstagePaths: z.array(z.string().min(1)).default([]),
  unstagedStatus: z
    .enum(["added", "conflicted", "deleted", "modified", "renamed"])
    .nullable()
    .default(null),
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
  if (!item) {
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
  if (!item) {
    return false;
  }
  if (item.unstagePaths.length > 0) {
    return true;
  }
  return item.kind === "file" && item.hasStaged;
}

/** untracked(纯 unstaged added)与 rename 不提供 discard,避免语义歧义的破坏操作。 */
function canDiscard(item: GitReviewTreeItemMetadata | null): boolean {
  if (!item) {
    return false;
  }
  if (item.discardPaths.length > 0) {
    return true;
  }
  return (
    item.kind === "file" &&
    item.hasUnstaged &&
    (item.unstagedStatus === "modified" || item.unstagedStatus === "deleted")
  );
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

function discardOperationPaths(item: GitReviewTreeItemMetadata): string[] {
  if (item.discardPaths.length > 0) {
    return [...item.discardPaths];
  }
  return [item.path];
}

export function registerGitReviewTreeActions(
  context: RendererPluginContext
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
      enabled: () => true,
      handler: async (invocation) => {
        const item = parseGitReviewTreeItemMetadata(invocation);
        if (!canStage(item) || item === null) {
          return;
        }
        try {
          const ok = await context.git.stage(
            item.gitRootPath,
            stageOperationPaths(item)
          );
          if (!ok) {
            notifyError(
              context,
              pluginText(context, "reviewTreeStageFailed", "Unable to Stage")
            );
          }
        } catch (error) {
          notifyError(
            context,
            pluginText(context, "reviewTreeStageFailed", "Unable to Stage"),
            error
          );
        }
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
      enabled: () => true,
      handler: async (invocation) => {
        const item = parseGitReviewTreeItemMetadata(invocation);
        if (!canUnstage(item) || item === null) {
          return;
        }
        try {
          const ok = await context.git.unstage(
            item.gitRootPath,
            unstageOperationPaths(item)
          );
          if (!ok) {
            notifyError(
              context,
              pluginText(
                context,
                "reviewTreeUnstageFailed",
                "Unable to Unstage"
              )
            );
          }
        } catch (error) {
          notifyError(
            context,
            pluginText(context, "reviewTreeUnstageFailed", "Unable to Unstage"),
            error
          );
        }
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
      enabled: () => true,
      handler: async (invocation) => {
        const item = parseGitReviewTreeItemMetadata(invocation);
        if (!canDiscard(item) || item === null) {
          return;
        }
        const paths = discardOperationPaths(item);
        const title = pluginText(context, "reviewTreeDiscardFile", "Restore");
        const subject =
          item.kind === "directory"
            ? pluginText(
                context,
                "reviewTreeDiscardFolderName",
                "{{count}} files in {{name}}",
                { count: paths.length, name: basename(item.path) }
              )
            : basename(item.path);
        const confirmed = await confirmDialog(
          context,
          title,
          pluginText(
            context,
            "reviewTreeDiscardConfirm",
            "Restore changes in {{name}}?\nThis cannot be undone.",
            { name: subject }
          ),
          pluginText(context, "reviewTreeDiscardConfirmButton", "Restore"),
          undefined,
          { intent: "destructive" }
        );
        if (!confirmed) {
          return;
        }
        try {
          const ok = await context.git.discardChanges(item.gitRootPath, paths);
          if (!ok) {
            notifyError(
              context,
              pluginText(
                context,
                "reviewTreeDiscardFailed",
                "Unable to Restore"
              )
            );
          }
        } catch (error) {
          notifyError(
            context,
            pluginText(context, "reviewTreeDiscardFailed", "Unable to Restore"),
            error
          );
        }
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
      title: () => pluginText(context, "reviewTreeDiscardFile", "Restore"),
    }),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
