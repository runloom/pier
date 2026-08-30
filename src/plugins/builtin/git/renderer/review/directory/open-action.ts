import type {
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { Folder } from "lucide-react";
import { GIT_CHANGES_PANEL_ID } from "../../../manifest.ts";
import { readGitReviewScope } from "../../pending-reveal-params.ts";
import { pluginText } from "../../plugin-text.ts";
import { panelContextFromReviewGitRoot } from "../context/from-git-root.ts";
import {
  GIT_REVIEW_DIFF_SURFACE,
  parseGitReviewDiffOpenMetadata,
} from "../diff-actions.ts";
import {
  parseGitReviewTreeItemMetadata,
  reviewTreeItemRepoPath,
} from "../tree-item-model.ts";

export const GIT_REVIEW_OPEN_DIRECTORY_COMMAND_ID =
  "pier.git.review.openDirectory";
export const GIT_REVIEW_TAB_SURFACE = "dockview-tab";

export interface GitReviewOpenDirectoryTarget {
  readonly contextId: string;
  readonly gitRootPath: string;
  readonly path?: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function gitRootFromPanelContext(
  context: RendererPluginActionInvocation["sourcePanelContext"]
): string | null {
  if (!context) {
    return null;
  }
  if (isNonEmptyString(context.gitRoot)) {
    return context.gitRoot;
  }
  if (isNonEmptyString(context.projectRootPath)) {
    return context.projectRootPath;
  }
  if (isNonEmptyString(context.worktreeRoot)) {
    return context.worktreeRoot;
  }
  return null;
}

function resolveReviewTabTarget(
  invocation: RendererPluginActionInvocation | undefined,
  reviewScopeForPanel?: (panelId: string) => GitReviewOpenDirectoryTarget | null
): GitReviewOpenDirectoryTarget | null {
  if (invocation?.sourcePanelComponent !== GIT_CHANGES_PANEL_ID) {
    return null;
  }
  const panelId = invocation.sourcePanelId;
  if (panelId && reviewScopeForPanel) {
    const fromParams = reviewScopeForPanel(panelId);
    if (fromParams) {
      return fromParams;
    }
  }
  const contextId = invocation.sourcePanelContext?.contextId;
  const gitRootPath = gitRootFromPanelContext(invocation.sourcePanelContext);
  if (isNonEmptyString(contextId) && gitRootPath) {
    return { contextId, gitRootPath };
  }
  return null;
}

export function resolveGitReviewOpenDirectoryTarget(
  invocation: RendererPluginActionInvocation | undefined,
  options?: {
    readonly reviewScopeForPanel?: (
      panelId: string
    ) => GitReviewOpenDirectoryTarget | null;
  }
): GitReviewOpenDirectoryTarget | null {
  const treeItem = parseGitReviewTreeItemMetadata(invocation);
  if (treeItem) {
    const repoPath = reviewTreeItemRepoPath(treeItem);
    return repoPath == null || repoPath.length === 0
      ? { contextId: treeItem.contextId, gitRootPath: treeItem.gitRootPath }
      : {
          contextId: treeItem.contextId,
          gitRootPath: treeItem.gitRootPath,
          path: repoPath,
        };
  }
  const diff = parseGitReviewDiffOpenMetadata(invocation);
  if (diff) {
    return {
      contextId: diff.contextId,
      gitRootPath: diff.gitRootPath,
      path: diff.path,
    };
  }
  const metadata = invocation?.metadata;
  const contextId = metadata?.contextId;
  const gitRootPath = metadata?.gitRootPath;
  if (isNonEmptyString(contextId) && isNonEmptyString(gitRootPath)) {
    return { contextId, gitRootPath };
  }
  return resolveReviewTabTarget(invocation, options?.reviewScopeForPanel);
}

export function registerGitReviewOpenDirectoryAction(
  context: RendererPluginContext
): () => void {
  const reviewScopeForPanel = (
    panelId: string
  ): GitReviewOpenDirectoryTarget | null => {
    const instance = context.panels
      .listInstances(GIT_CHANGES_PANEL_ID)
      .find((entry) => entry.id === panelId);
    const scope = readGitReviewScope(instance?.params);
    if (!scope) {
      return null;
    }
    return { contextId: scope.contextId, gitRootPath: scope.gitRootPath };
  };
  const resolveTarget = (
    invocation: RendererPluginActionInvocation | undefined
  ) => resolveGitReviewOpenDirectoryTarget(invocation, { reviewScopeForPanel });

  return context.actions.register({
    category: "git",
    enabled: (invocation) => resolveTarget(invocation) != null,
    handler: async (invocation) => {
      const target = resolveTarget(invocation);
      if (!target) {
        return;
      }
      const result = await context.files.openProjectDirectory({
        context: panelContextFromReviewGitRoot({
          contextId: target.contextId,
          gitRootPath: target.gitRootPath,
          ...(invocation?.sourcePanelContext
            ? { sourcePanelContext: invocation.sourcePanelContext }
            : {}),
        }),
        root: target.gitRootPath,
        ...(target.path ? { path: target.path } : {}),
      });
      if (!result.ok) {
        context.notifications.error(
          pluginText(
            context,
            "reviewOpenDirectoryFailed",
            "Unable to open project directory"
          )
        );
      }
    },
    id: GIT_REVIEW_OPEN_DIRECTORY_COMMAND_ID,
    metadata: {
      categoryKey: "git",
      group: "1_open",
      iconComponent: Folder,
      menuHidden: (invocation) => resolveTarget(invocation) == null,
      sortOrder: 1,
    },
    surfaces: [
      "git/review-tree-item",
      GIT_REVIEW_DIFF_SURFACE,
      GIT_REVIEW_TAB_SURFACE,
    ],
    title: () => pluginText(context, "reviewOpenDirectory", "Open Directory"),
  });
}
