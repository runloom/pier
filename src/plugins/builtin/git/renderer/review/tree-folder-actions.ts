import type {
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { gitReviewScopeSchema } from "@shared/contracts/git/review.ts";
import { GIT_CHANGES_PANEL_ID } from "../../manifest.ts";
import { pluginText } from "../plugin-text.ts";
import { toggleGitReviewTreeSidebar } from "./tree/sidebar-preference.ts";
import {
  collapseGitReviewTreeFolders,
  expandGitReviewTreeFolders,
} from "./tree-collapse-registry.ts";

export const GIT_REVIEW_COLLAPSE_FOLDERS_COMMAND_ID =
  "pier.git.review.collapseFolders";
export const GIT_REVIEW_EXPAND_ALL_COMMAND_ID = "pier.git.review.expandAll";
export const GIT_REVIEW_TOGGLE_TREE_COMMAND_ID = "pier.git.review.toggleTree";

function activeGitReviewRootPath(
  context: RendererPluginContext
): string | null {
  const panelId = context.panels.getActiveInstanceId(GIT_CHANGES_PANEL_ID);
  if (!panelId) {
    return null;
  }
  const instance = context.panels
    .listInstances(GIT_CHANGES_PANEL_ID)
    .find((entry) => entry.id === panelId);
  const params = instance?.params;
  if (!(params && typeof params === "object" && "source" in params)) {
    return null;
  }
  const parsed = gitReviewScopeSchema.safeParse(params.source);
  return parsed.success ? parsed.data.gitRootPath : null;
}

interface ExpandRootItem {
  kind: "directory" | "file";
  path: string;
}

function reviewTreeExpandRootPath(
  item: ExpandRootItem | null
): string | undefined {
  if (!item) {
    return;
  }
  if (item.kind === "directory") {
    return item.path;
  }
  const slash = item.path.lastIndexOf("/");
  return slash < 0 ? undefined : item.path.slice(0, slash);
}

/** Expand/Collapse Folders (context menu) + toggle tree sidebar (keybinding). */
export function registerGitReviewTreeFolderActions(options: {
  context: RendererPluginContext;
  parseItem: (
    invocation: RendererPluginActionInvocation | undefined
  ) => ExpandRootItem | null;
  surface: string;
}): () => void {
  const { context, parseItem, surface } = options;
  const disposers = [
    context.actions.register({
      category: "git",
      enabled: () => true,
      handler: async () => {
        if (!toggleGitReviewTreeSidebar(activeGitReviewRootPath(context))) {
          context.notifications.info(
            pluginText(
              context,
              "reviewToggleTreeUnavailable",
              "Open a git repository first."
            )
          );
        }
        return await Promise.resolve();
      },
      id: GIT_REVIEW_TOGGLE_TREE_COMMAND_ID,
      metadata: {
        categoryKey: "git",
        group: "2_view",
        shortcutSourceId: "pier.view.toggleSideTree",
        sortOrder: 48,
      },
      // Invoked from global pier.view.toggleSideTree while Changes is active.
      surfaces: [],
      title: () =>
        pluginText(context, "reviewToggleTree", "Toggle Changed Files Tree"),
    }),
    context.actions.register({
      category: "git",
      enabled: () => true,
      handler: async (invocation) => {
        expandGitReviewTreeFolders(
          reviewTreeExpandRootPath(parseItem(invocation))
        );
        return await Promise.resolve();
      },
      id: GIT_REVIEW_EXPAND_ALL_COMMAND_ID,
      metadata: {
        categoryKey: "git",
        group: "2_view",
        menuHidden: (invocation) => parseItem(invocation)?.kind === "file",
        sortOrder: 49,
      },
      surfaces: [surface],
      title: () => pluginText(context, "reviewTreeExpandAll", "Expand Folders"),
    }),
    context.actions.register({
      category: "git",
      enabled: () => true,
      handler: async (invocation) => {
        collapseGitReviewTreeFolders(
          reviewTreeExpandRootPath(parseItem(invocation))
        );
        return await Promise.resolve();
      },
      id: GIT_REVIEW_COLLAPSE_FOLDERS_COMMAND_ID,
      metadata: {
        categoryKey: "git",
        group: "2_view",
        menuHidden: (invocation) => parseItem(invocation)?.kind === "file",
        sortOrder: 50,
      },
      surfaces: [surface],
      title: () =>
        pluginText(context, "reviewTreeCollapseAll", "Collapse Folders"),
    }),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
