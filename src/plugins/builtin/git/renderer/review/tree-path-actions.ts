import type {
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { pluginText } from "../plugin-text.ts";

export const GIT_REVIEW_COPY_PATH_COMMAND_ID = "pier.git.review.copyPath";
export const GIT_REVIEW_COPY_RELATIVE_PATH_COMMAND_ID =
  "pier.git.review.copyRelativePath";
export const GIT_REVIEW_REVEAL_COMMAND_ID = "pier.git.review.revealInFinder";

interface PathItem {
  gitRootPath: string;
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
  if (window.pier?.clipboard?.writeText) {
    await window.pier.clipboard.writeText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}

export function registerGitReviewTreePathActions(options: {
  context: RendererPluginContext;
  parseItem: (
    invocation: RendererPluginActionInvocation | undefined
  ) => PathItem | null;
  surface: string;
}): () => void {
  const { context, parseItem, surface } = options;
  const disposers = [
    context.actions.register({
      category: "Git",
      enabled: (invocation) => parseItem(invocation) != null,
      handler: async (invocation) => {
        const item = parseItem(invocation);
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
        sortOrder: 1,
      },
      surfaces: [surface],
      title: () => pluginText(context, "reviewTreeCopyPath", "Copy Path"),
    }),
    context.actions.register({
      category: "Git",
      enabled: (invocation) => parseItem(invocation) != null,
      handler: async (invocation) => {
        const item = parseItem(invocation);
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
        sortOrder: 2,
      },
      surfaces: [surface],
      title: () =>
        pluginText(context, "reviewTreeCopyRelativePath", "Copy Relative Path"),
    }),
    context.actions.register({
      category: "Git",
      enabled: (invocation) => parseItem(invocation) != null,
      handler: async (invocation) => {
        const item = parseItem(invocation);
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
