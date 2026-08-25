import type {
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { GIT_CHANGES_PANEL_ID } from "../../manifest.ts";
import { pluginText } from "../plugin-text.ts";
import {
  GIT_REVIEW_DIFF_SURFACE,
  parseGitReviewDiffOpenMetadata,
} from "./diff-actions.ts";
import {
  type GitReviewTreeItemMetadata,
  reviewTreeItemRepoPath,
} from "./tree-item-model.ts";

export const GIT_REVIEW_COPY_PATH_COMMAND_ID = "pier.git.review.copyPath";
export const GIT_REVIEW_COPY_RELATIVE_PATH_COMMAND_ID =
  "pier.git.review.copyRelativePath";
export const GIT_REVIEW_COPY_PATH_WITH_RANGE_COMMAND_ID =
  "pier.git.review.copyPathWithRange";
export const GIT_REVIEW_REVEAL_COMMAND_ID = "pier.git.review.revealInFinder";

interface PathItem {
  endLine?: number;
  gitRootPath: string;
  /** Repo-relative path (never includes synthetic group roots). */
  path: string;
  startLine?: number;
}

type LiveCopyTargetProvider = () => PathItem | null;

const liveCopyTargetProviders = new Map<string, LiveCopyTargetProvider>();

export function registerGitReviewLiveCopyTarget(
  panelId: string,
  provider: LiveCopyTargetProvider
): () => void {
  liveCopyTargetProviders.set(panelId, provider);
  return () => {
    if (liveCopyTargetProviders.get(panelId) === provider) {
      liveCopyTargetProviders.delete(panelId);
    }
  };
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

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    Math.floor(value) === value
    ? value
    : undefined;
}

export function formatRepoPathWithRange(
  path: string,
  startLine: number,
  endLine: number
): string {
  return startLine === endLine
    ? `${path}:${startLine}`
    : `${path}:${startLine}-${endLine}`;
}

function pathRangeFromInvocation(
  invocation: RendererPluginActionInvocation | undefined,
  item: PathItem | null
): { endLine: number; startLine: number } | null {
  if (!item) {
    return null;
  }
  const start =
    asPositiveInt(invocation?.metadata?.selectionStartLine) ??
    asPositiveInt(invocation?.metadata?.line) ??
    item.startLine;
  if (start == null) {
    return null;
  }
  const end =
    asPositiveInt(invocation?.metadata?.selectionEndLine) ??
    item.endLine ??
    start;
  return { endLine: end, startLine: start };
}

function formatCopyPathValue(
  invocation: RendererPluginActionInvocation | undefined,
  item: PathItem
): string {
  const range = pathRangeFromInvocation(invocation, item);
  return range
    ? formatRepoPathWithRange(item.path, range.startLine, range.endLine)
    : item.path;
}

export function registerGitReviewTreePathActions(options: {
  context: RendererPluginContext;
  parseItem: (
    invocation: RendererPluginActionInvocation | undefined
  ) => GitReviewTreeItemMetadata | null;
  surfaces: readonly string[];
}): () => void {
  const { context, parseItem, surfaces } = options;
  const resolvePathItem = (
    invocation: RendererPluginActionInvocation | undefined
  ): PathItem | null => {
    const treeItem = parseItem(invocation);
    if (treeItem) {
      return pathItemFromMetadata(treeItem);
    }
    const open = parseGitReviewDiffOpenMetadata(invocation);
    if (open) {
      return { gitRootPath: open.gitRootPath, path: open.path };
    }
    const panelId =
      invocation?.sourcePanelId ??
      context.panels?.getActiveInstanceId(GIT_CHANGES_PANEL_ID);
    if (!panelId) {
      return null;
    }
    return liveCopyTargetProviders.get(panelId)?.() ?? null;
  };

  const disposers = [
    context.actions.register({
      category: "git",
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
      surfaces,
      title: () => pluginText(context, "reviewTreeCopyPath", "Copy Path"),
    }),
    context.actions.register({
      category: "git",
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
      surfaces,
      title: () =>
        pluginText(context, "reviewTreeCopyRelativePath", "Copy Relative Path"),
    }),
    context.actions.register({
      category: "git",
      enabled: (invocation) => resolvePathItem(invocation) != null,
      handler: async (invocation) => {
        const item = resolvePathItem(invocation);
        if (!item) {
          return;
        }
        try {
          await writeClipboardText(formatCopyPathValue(invocation, item));
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
      id: GIT_REVIEW_COPY_PATH_WITH_RANGE_COMMAND_ID,
      metadata: {
        categoryKey: "git",
        group: "6_path",
        menuHidden: (invocation) => resolvePathItem(invocation) == null,
        sortOrder: 3,
      },
      surfaces: [GIT_REVIEW_DIFF_SURFACE],
      title: () =>
        pluginText(
          context,
          "reviewCopyPathWithRange",
          "Copy Path and Selected Lines"
        ),
    }),
    context.actions.register({
      category: "git",
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
      surfaces,
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
