import { isFileTreeEditingKeyEvent } from "@pier/ui/file/tree-selection-model.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { pluginText } from "../../plugin-text.ts";
import { confirmGitDiscard } from "../discard.ts";
import { activeGitReviewMutationAuthority } from "../mutation-authority.ts";
import type { GitReviewTreeModel } from "../tree.tsx";
import { buildGitReviewTreeItemMenuFlags } from "../tree-context-menu.ts";
import {
  canDiscard,
  canStage,
  canUnstage,
  discardSelectionFromItem,
  type GitReviewTreeItemMetadata,
  isMutableReviewItem,
  runTreePathMutation,
  stageOperationPaths,
  unstageOperationPaths,
} from "../tree-item-model.ts";
import { collectReviewTreeSelectionFileRefs } from "./selection-menu.ts";

function metadataFromSelection(
  treeModel: GitReviewTreeModel,
  selectedPaths: readonly string[],
  contextId: string,
  gitRootPath: string,
  mutationBlocked: boolean
): GitReviewTreeItemMetadata | null {
  const paths = selectedPaths.length > 0 ? selectedPaths : [];
  if (paths.length === 0) {
    return null;
  }
  const clickedPath = paths[0] ?? "";
  const fileRefs = collectReviewTreeSelectionFileRefs(treeModel, paths);
  const flags = buildGitReviewTreeItemMenuFlags({ fileRefs });
  const item = treeModel.items.find((entry) => entry.path === clickedPath);
  return {
    allDiscardTrackedDeleted: flags.allDiscardTrackedDeleted,
    contextId,
    copyPaths: [],
    discardPaths: [...flags.discardPaths],
    discardTrackedPaths: [...flags.discardTrackedPaths],
    discardUntrackedPaths: [...flags.discardUntrackedPaths],
    expectedIndexRevision: treeModel.mutation.expectedIndexRevision,
    gitRootPath,
    hasConflict: flags.hasConflict,
    hasStaged: flags.hasStaged,
    hasUnstaged: flags.hasUnstaged,
    kind: item?.kind === "directory" ? "directory" : "file",
    mutationBlocked,
    oldPaths: [],
    path: clickedPath,
    selectedPaths: [...paths],
    stagePaths: [...flags.stagePaths],
    uncommitted: treeModel.mutation.uncommitted,
    unstagePaths: [...flags.unstagePaths],
    unstagedStatus: flags.unstagedStatus,
  };
}

export function handleGitReviewTreeKeyDown(
  event: KeyboardEvent,
  options: {
    context: RendererPluginContext;
    contextId: string;
    gitRootPath: string;
    mutationBlocked: boolean;
    searchOpen: boolean;
    selectedPaths: readonly string[];
    treeModel: GitReviewTreeModel;
  }
): void {
  if (event.repeat || options.searchOpen || isFileTreeEditingKeyEvent(event)) {
    return;
  }
  if (event.key === " " || event.key === "Spacebar") {
    const item = metadataFromSelection(
      options.treeModel,
      options.selectedPaths,
      options.contextId,
      options.gitRootPath,
      options.mutationBlocked
    );
    if (
      !(
        isMutableReviewItem(item) &&
        item.mutationBlocked !== true &&
        (canStage(item) || canUnstage(item))
      )
    ) {
      return;
    }
    event.preventDefault();
    runReviewTreeSpace(options).catch(() => undefined);
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    const item = metadataFromSelection(
      options.treeModel,
      options.selectedPaths,
      options.contextId,
      options.gitRootPath,
      options.mutationBlocked
    );
    if (
      !(
        isMutableReviewItem(item) &&
        item.mutationBlocked !== true &&
        canDiscard(item)
      )
    ) {
      return;
    }
    event.preventDefault();
    runReviewTreeDiscard(options).catch(() => undefined);
  }
}

async function runReviewTreeSpace(options: {
  context: RendererPluginContext;
  contextId: string;
  gitRootPath: string;
  mutationBlocked: boolean;
  selectedPaths: readonly string[];
  treeModel: GitReviewTreeModel;
}): Promise<void> {
  const item = metadataFromSelection(
    options.treeModel,
    options.selectedPaths,
    options.contextId,
    options.gitRootPath,
    options.mutationBlocked
  );
  if (!(isMutableReviewItem(item) && item.mutationBlocked !== true)) {
    return;
  }
  if (canStage(item)) {
    await mutateReviewTree(
      options.context,
      item,
      "stage",
      stageOperationPaths(item)
    );
    return;
  }
  if (canUnstage(item)) {
    await mutateReviewTree(
      options.context,
      item,
      "unstage",
      unstageOperationPaths(item)
    );
  }
}

async function runReviewTreeDiscard(options: {
  context: RendererPluginContext;
  contextId: string;
  gitRootPath: string;
  mutationBlocked: boolean;
  selectedPaths: readonly string[];
  treeModel: GitReviewTreeModel;
}): Promise<void> {
  const item = metadataFromSelection(
    options.treeModel,
    options.selectedPaths,
    options.contextId,
    options.gitRootPath,
    options.mutationBlocked
  );
  if (
    !(
      isMutableReviewItem(item) &&
      item.mutationBlocked !== true &&
      canDiscard(item)
    )
  ) {
    return;
  }
  const decision = await confirmGitDiscard(
    options.context,
    discardSelectionFromItem(item)
  );
  if (decision.kind !== "proceed" || decision.paths.length === 0) {
    return;
  }
  await mutateReviewTree(options.context, item, "revert", decision.paths);
}

async function mutateReviewTree(
  context: RendererPluginContext,
  item: GitReviewTreeItemMetadata & { expectedIndexRevision: string },
  action: "stage" | "unstage" | "revert",
  paths: readonly string[]
): Promise<void> {
  const authority = activeGitReviewMutationAuthority();
  if (!authority) {
    return;
  }
  let title = pluginText(
    context,
    "reviewDiscardFailed",
    "Unable to discard changes"
  );
  if (action === "stage") {
    title = pluginText(context, "reviewTreeStageFailed", "Unable to Stage");
  } else if (action === "unstage") {
    title = pluginText(context, "reviewTreeUnstageFailed", "Unable to Unstage");
  }
  await runTreePathMutation({
    action,
    authority,
    context,
    item,
    paths,
    title,
  });
}
