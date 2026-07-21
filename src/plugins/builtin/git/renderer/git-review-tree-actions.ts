import type {
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { FileText, Minus, Plus, Undo2 } from "lucide-react";
import { z } from "zod";
import { confirmDialog, showError } from "./git-command-helpers.ts";
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
  return (
    item?.kind === "file" && (item.hasUnstaged || item.hasConflict === true)
  );
}

function canUnstage(item: GitReviewTreeItemMetadata | null): boolean {
  return item?.kind === "file" && item.hasStaged;
}

/** untracked(纯 unstaged added)与 rename 不提供 discard,避免语义歧义的破坏操作。 */
function canDiscard(item: GitReviewTreeItemMetadata | null): boolean {
  return (
    item?.kind === "file" &&
    item.hasUnstaged &&
    (item.unstagedStatus === "modified" || item.unstagedStatus === "deleted")
  );
}

function operationPaths(item: GitReviewTreeItemMetadata): string[] {
  return [item.path, ...item.oldPaths.filter((path) => path !== item.path)];
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
        group: "1_open",
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
          await context.git.stage(item.gitRootPath, operationPaths(item));
        } catch (error) {
          await showError(
            context,
            pluginText(context, "reviewTreeStageFailed", "Unable to stage"),
            error
          );
        }
      },
      id: GIT_REVIEW_STAGE_FILE_COMMAND_ID,
      metadata: {
        categoryKey: "git",
        group: "2_stage",
        iconComponent: Plus,
        menuHidden: (invocation) =>
          !canStage(parseGitReviewTreeItemMetadata(invocation)),
        sortOrder: 10,
      },
      surfaces: [GIT_REVIEW_TREE_ITEM_SURFACE],
      title: () => pluginText(context, "reviewTreeStageFile", "Stage Changes"),
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
          await context.git.unstage(item.gitRootPath, operationPaths(item));
        } catch (error) {
          await showError(
            context,
            pluginText(context, "reviewTreeUnstageFailed", "Unable to unstage"),
            error
          );
        }
      },
      id: GIT_REVIEW_UNSTAGE_FILE_COMMAND_ID,
      metadata: {
        categoryKey: "git",
        group: "2_stage",
        iconComponent: Minus,
        menuHidden: (invocation) =>
          !canUnstage(parseGitReviewTreeItemMetadata(invocation)),
        sortOrder: 11,
      },
      surfaces: [GIT_REVIEW_TREE_ITEM_SURFACE],
      title: () =>
        pluginText(context, "reviewTreeUnstageFile", "Unstage Changes"),
    }),
    context.actions.register({
      category: "Git",
      enabled: () => true,
      handler: async (invocation) => {
        const item = parseGitReviewTreeItemMetadata(invocation);
        if (!canDiscard(item) || item === null) {
          return;
        }
        const title = pluginText(
          context,
          "reviewTreeDiscardFile",
          "Discard Changes"
        );
        const confirmed = await confirmDialog(
          context,
          title,
          pluginText(
            context,
            "reviewTreeDiscardConfirm",
            "Discard changes in {{name}}? This cannot be undone.",
            { name: basename(item.path) }
          ),
          pluginText(context, "reviewTreeDiscardConfirmButton", "Discard"),
          undefined,
          { intent: "destructive" }
        );
        if (!confirmed) {
          return;
        }
        try {
          await context.git.discardChanges(item.gitRootPath, [item.path]);
        } catch (error) {
          await showError(
            context,
            pluginText(
              context,
              "reviewTreeDiscardFailed",
              "Unable to discard changes"
            ),
            error
          );
        }
      },
      id: GIT_REVIEW_DISCARD_FILE_COMMAND_ID,
      metadata: {
        categoryKey: "git",
        group: "3_discard",
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
