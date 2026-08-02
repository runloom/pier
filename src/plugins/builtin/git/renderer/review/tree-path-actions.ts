import type {
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { pluginText } from "../plugin-text.ts";
import {
  type GitReviewTreeItemMetadata,
  reviewTreeItemRepoPath,
} from "./tree-item-model.ts";

export const GIT_REVIEW_COPY_PATH_COMMAND_ID = "pier.git.review.copyPath";
export const GIT_REVIEW_COPY_RELATIVE_PATH_COMMAND_ID =
  "pier.git.review.copyRelativePath";
export const GIT_REVIEW_REVEAL_COMMAND_ID = "pier.git.review.revealInFinder";

interface PathItem {
  gitRootPath: string;
  /** Repo-relative path (never includes synthetic group roots). */
  path: string;
}

function joinAbsolutePath(root: string, path: string): string {
  if (path.length === 0) {
    return root;
  }
  if (root.endsWith("/")) {
    return `${root}${path}`;
  }
  return `${root}/${path}`;
}

async function writeClipboardText(text: string): Promise<void> {
  // Plugin renderer must not touch preload globals; use browser clipboard API.
  await navigator.clipboard.writeText(text);
}

function pathItemFromMetadata(
  item: GitReviewTreeItemMetadata | null
): PathItem | null {
  if (!item) {
    return null;
  }
  const repoPath = reviewTreeItemRepoPath(item);
  if (repoPath == null || repoPath.length === 0) {
    return null;
  }
  return { gitRootPath: item.gitRootPath, path: repoPath };
}

export function registerGitReviewTreePathActions(options: {
  context: RendererPluginContext;
  parseItem: (
    invocation: RendererPluginActionInvocation | undefined
  ) => GitReviewTreeItemMetadata | null;
  surface: string;
}): () => void {
  const { context, parseItem, surface } = options;
  const resolvePathItem = (
    invocation: RendererPluginActionInvocation | undefined
  ): PathItem | null => pathItemFromMetadata(parseItem(invocation));

  const disposers = [
    context.actions.register({
      category: "Git",
      enabled: (invocation) => resolvePathItem(invocation) != null,
      handler: async (invocation) => {
        const item = resolvePathItem(invocation);
        if (!item) {
          return;
        }
        try {
          await writeClipboardText(
            joinAbsolutePath(item.gitRootPath, item.path)
          );
          context.notifications.success(
            pluginText(context, "reviewTreePathCopied", "Path copied")
          );
        } catch (error) {
          await context.dialogs.alert({
            body: error instanceof Error ? error.message : String(error),
            title: pluginText(
              context,
              "reviewTreeCopyPathFailed",
              "Couldn't copy path"
            ),
          });
        }
      },
      id: GIT_REVIEW_COPY_PATH_COMMAND_ID,
      metadata: {
        categoryKey: "git",
        group: "6_path",
        menuHidden: (invocation) => resolvePathItem(invocation) == null,
        sortOrder: 1,
      },
      surfaces: [surface],
      title: () => pluginText(context, "reviewTreeCopyPath", "Copy Path"),
    }),
    context.actions.register({
      category: "Git",
      enabled: (invocation) => resolvePathItem(invocation) != null,
      handler: async (invocation) => {
        const item = resolvePathItem(invocation);
        if (!item) {
          return;
        }
        try {
          await writeClipboardText(item.path);
          context.notifications.success(
            pluginText(context, "reviewTreePathCopied", "Path copied")
          );
        } catch (error) {
          await context.dialogs.alert({
            body: error instanceof Error ? error.message : String(error),
            title: pluginText(
              context,
              "reviewTreeCopyPathFailed",
              "Couldn't copy path"
            ),
          });
        }
      },
      id: GIT_REVIEW_COPY_RELATIVE_PATH_COMMAND_ID,
      metadata: {
        categoryKey: "git",
        group: "6_path",
        menuHidden: (invocation) => resolvePathItem(invocation) == null,
        sortOrder: 2,
      },
      surfaces: [surface],
      title: () =>
        pluginText(context, "reviewTreeCopyRelativePath", "Copy Relative Path"),
    }),
    context.actions.register({
      category: "Git",
      enabled: (invocation) => resolvePathItem(invocation) != null,
      handler: async (invocation) => {
        const item = resolvePathItem(invocation);
        if (!item) {
          return;
        }
        try {
          await context.files.reveal({
            path: item.path,
            root: item.gitRootPath,
          });
        } catch (error) {
          await context.dialogs.alert({
            body: error instanceof Error ? error.message : String(error),
            title: pluginText(
              context,
              "reviewTreeRevealFailed",
              "Couldn't reveal item"
            ),
          });
        }
      },
      id: GIT_REVIEW_REVEAL_COMMAND_ID,
      metadata: {
        categoryKey: "git",
        group: "6_path",
        menuHidden: (invocation) => resolvePathItem(invocation) == null,
        sortOrder: 4,
      },
      surfaces: [surface],
      title: () =>
        pluginText(context, "reviewTreeRevealInFinder", "Reveal in Finder"),
    }),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
