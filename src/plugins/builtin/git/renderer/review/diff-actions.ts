import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { FileText } from "lucide-react";
import { pluginText } from "../plugin-text.ts";
import { reviewMutationBasename } from "./code-mutation-helpers.ts";
import { panelContextFromReviewGitRoot } from "./panel-context-from-review.ts";

export const GIT_REVIEW_DIFF_SURFACE = "git/review-diff";
export const GIT_REVIEW_OPEN_IN_EDITOR_COMMAND_ID =
  "pier.git.review.openInEditor";

export interface GitReviewDiffOpenMetadata {
  readonly contextId: string;
  readonly gitRootPath: string;
  readonly line?: number;
  readonly path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseGitReviewDiffOpenMetadata(
  invocation: { metadata?: Record<string, unknown> } | undefined
): GitReviewDiffOpenMetadata | null {
  const metadata = invocation?.metadata;
  if (!isRecord(metadata)) {
    return null;
  }
  const path = metadata.path;
  const gitRootPath = metadata.gitRootPath;
  const contextId = metadata.contextId;
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    typeof gitRootPath !== "string" ||
    gitRootPath.length === 0 ||
    typeof contextId !== "string" ||
    contextId.length === 0
  ) {
    return null;
  }
  const lineRaw = metadata.line;
  const line =
    typeof lineRaw === "number" &&
    Number.isFinite(lineRaw) &&
    lineRaw >= 1 &&
    Math.floor(lineRaw) === lineRaw
      ? lineRaw
      : undefined;
  return line === undefined
    ? { contextId, gitRootPath, path }
    : { contextId, gitRootPath, line, path };
}

export function openGitReviewPathInEditor(options: {
  readonly context: RendererPluginContext;
  readonly contextId: string;
  readonly gitRootPath: string;
  readonly line?: number;
  readonly path: string;
  readonly sourcePanelContext?: PanelContext | null;
}): boolean {
  const { context, contextId, gitRootPath, line, path, sourcePanelContext } =
    options;
  return context.files.openInEditor({
    context: panelContextFromReviewGitRoot({
      contextId,
      gitRootPath,
      ...(sourcePanelContext ? { sourcePanelContext } : {}),
    }),
    path,
    root: gitRootPath,
    title: reviewMutationBasename(path),
    ...(line === undefined ? {} : { line }),
  });
}

export function registerGitReviewDiffActions(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    enabled: (invocation) => parseGitReviewDiffOpenMetadata(invocation) != null,
    handler: (invocation) => {
      const target = parseGitReviewDiffOpenMetadata(invocation);
      if (!target) {
        return;
      }
      const opened = openGitReviewPathInEditor({
        context,
        contextId: target.contextId,
        gitRootPath: target.gitRootPath,
        path: target.path,
        ...(target.line === undefined ? {} : { line: target.line }),
        ...(invocation?.sourcePanelContext
          ? { sourcePanelContext: invocation.sourcePanelContext }
          : {}),
      });
      if (!opened) {
        context.notifications.error(
          pluginText(context, "reviewOpenFileFailed", "Couldn't open file")
        );
      }
    },
    id: GIT_REVIEW_OPEN_IN_EDITOR_COMMAND_ID,
    metadata: {
      categoryKey: "git",
      group: "1_review",
      iconComponent: FileText,
      menuHidden: (invocation) =>
        parseGitReviewDiffOpenMetadata(invocation) == null,
      sortOrder: 0,
    },
    surfaces: [GIT_REVIEW_DIFF_SURFACE],
    title: () => pluginText(context, "reviewOpenInEditor", "Jump to Source"),
  });
}
