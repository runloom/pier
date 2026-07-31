import type {
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { pluginText } from "../plugin-text.ts";
import {
  collapseGitReviewTreeFolders,
  expandGitReviewTreeFolders,
} from "./tree-collapse-registry.ts";

export const GIT_REVIEW_COLLAPSE_FOLDERS_COMMAND_ID =
  "pier.git.review.collapseFolders";
export const GIT_REVIEW_EXPAND_ALL_COMMAND_ID = "pier.git.review.expandAll";

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

/** Context-menu only Expand/Collapse Folders (no toolbar, no default shortcuts). */
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
      category: "Git",
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
        sortOrder: 49,
      },
      surfaces: [surface],
      title: () => pluginText(context, "reviewTreeExpandAll", "Expand Folders"),
    }),
    context.actions.register({
      category: "Git",
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
