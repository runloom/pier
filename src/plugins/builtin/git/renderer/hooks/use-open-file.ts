import type { PierDiffViewItem } from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { type RefObject, useCallback } from "react";
import { pluginText } from "../plugin-text.ts";
import { openGitReviewPathInEditor } from "../review/diff-actions.ts";

/**
 * File-scoped open from diff header title (product: Open File / 打开文件).
 * Line/selection jumps use diff context menu → Jump to Source.
 */
export function useGitReviewOpenFile(options: {
  readonly context: RendererPluginContext;
  readonly contextId: string;
  readonly gitRootPath?: string;
  readonly itemsRef: RefObject<readonly PierDiffViewItem[]>;
  /** Prefer the review panel's own context when known; else active panel. */
  readonly sourcePanelContext?: PanelContext | null;
}): (itemId: string) => void {
  const { context, contextId, gitRootPath, itemsRef, sourcePanelContext } =
    options;
  return useCallback(
    (itemId: string) => {
      if (!gitRootPath) {
        return;
      }
      const item = itemsRef.current.find((entry) => entry.id === itemId);
      const path = item?.fileDisplay?.path;
      if (!path) {
        return;
      }
      const resolvedSource =
        sourcePanelContext ?? context.panels.getActiveContext();
      const opened = openGitReviewPathInEditor({
        context,
        contextId,
        gitRootPath,
        path,
        ...(resolvedSource ? { sourcePanelContext: resolvedSource } : {}),
      });
      if (!opened) {
        context.notifications.error(
          pluginText(context, "reviewOpenFileFailed", "Couldn't open file")
        );
      }
    },
    [context, contextId, gitRootPath, itemsRef, sourcePanelContext]
  );
}
