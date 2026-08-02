import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FileText, Minus, Plus, Undo2 } from "lucide-react";
import { pluginText } from "../plugin-text.ts";
import { confirmGitDiscard } from "./discard.ts";
import { GitReviewMutationAuthority } from "./mutation-authority.ts";
import { registerGitReviewTreeFolderActions } from "./tree-folder-actions.ts";
import {
  basename,
  canDiscard,
  canStage,
  canUnstage,
  discardSelectionFromItem,
  isMutableReviewItem,
  panelContextFromReviewItem,
  parseGitReviewTreeItemMetadata,
  reviewTreeItemRepoPath,
  runTreePathMutation,
  stageOperationPaths,
  unstageOperationPaths,
} from "./tree-item-model.ts";
import { registerGitReviewTreePathActions } from "./tree-path-actions.ts";

export const GIT_REVIEW_TREE_ITEM_SURFACE = "git/review-tree-item";
export const GIT_REVIEW_OPEN_FILE_COMMAND_ID = "pier.git.review.openFile";
export const GIT_REVIEW_STAGE_FILE_COMMAND_ID = "pier.git.review.stageFile";
export const GIT_REVIEW_UNSTAGE_FILE_COMMAND_ID = "pier.git.review.unstageFile";
export const GIT_REVIEW_DISCARD_FILE_COMMAND_ID = "pier.git.review.discardFile";
export {
  GIT_REVIEW_COLLAPSE_FOLDERS_COMMAND_ID,
  GIT_REVIEW_EXPAND_ALL_COMMAND_ID,
} from "./tree-folder-actions.ts";
export {
  type GitReviewTreeItemMetadata,
  parseGitReviewTreeItemMetadata,
} from "./tree-item-model.ts";

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
        const repoPath = reviewTreeItemRepoPath(item);
        if (repoPath == null) {
          return;
        }
        const opened = context.files.openInEditor({
          context: panelContextFromReviewItem(item),
          path: repoPath,
          root: item.gitRootPath,
          title: basename(repoPath),
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
      title: (invocation) => {
        const item = parseGitReviewTreeItemMetadata(invocation);
        const count = item ? stageOperationPaths(item).length : 0;
        if (count > 1) {
          return pluginText(
            context,
            "reviewTreeStageFileN",
            "Stage ({{count}})",
            {
              count,
            }
          );
        }
        return pluginText(context, "reviewTreeStageFile", "Stage");
      },
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
      title: (invocation) => {
        const item = parseGitReviewTreeItemMetadata(invocation);
        const count = item ? unstageOperationPaths(item).length : 0;
        if (count > 1) {
          return pluginText(
            context,
            "reviewTreeUnstageFileN",
            "Unstage ({{count}})",
            { count }
          );
        }
        return pluginText(context, "reviewTreeUnstageFile", "Unstage");
      },
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
      title: (invocation) => {
        const item = parseGitReviewTreeItemMetadata(invocation);
        if (!item) {
          return pluginText(
            context,
            "reviewTreeDiscardFile",
            "Discard Changes"
          );
        }
        const selection = discardSelectionFromItem(item);
        const count =
          selection.trackedPaths.length + selection.untrackedPaths.length;
        if (count > 1) {
          return pluginText(
            context,
            "reviewTreeDiscardFileN",
            "Discard Changes ({{count}})",
            { count }
          );
        }
        return pluginText(context, "reviewTreeDiscardFile", "Discard Changes");
      },
    }),
    registerGitReviewTreeFolderActions({
      context,
      parseItem: parseGitReviewTreeItemMetadata,
      surface: GIT_REVIEW_TREE_ITEM_SURFACE,
    }),
    registerGitReviewTreePathActions({
      context,
      parseItem: parseGitReviewTreeItemMetadata,
      surface: GIT_REVIEW_TREE_ITEM_SURFACE,
    }),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
