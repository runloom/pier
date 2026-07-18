import type {
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { FileText } from "lucide-react";
import { z } from "zod";
import { pluginText } from "./git-plugin-text.ts";

export const GIT_REVIEW_TREE_ITEM_SURFACE = "git/review-tree-item";
export const GIT_REVIEW_OPEN_FILE_COMMAND_ID = "pier.git.review.openFile";

const reviewTreeItemMetadataSchema = z.object({
  contextId: z.string().min(1),
  gitRootPath: z.string().min(1),
  kind: z.enum(["directory", "file"]),
  path: z.string().min(1),
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

export function registerGitReviewTreeActions(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
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
            "reviewTreeOpenFileUnavailable",
            "Files panel is unavailable"
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
  });
}
