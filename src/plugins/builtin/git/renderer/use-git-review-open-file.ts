import type { PierDiffViewItem } from "@pier/ui/diff-view.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { type RefObject, useCallback } from "react";
import { pluginText } from "./git-plugin-text.ts";
import { reviewMutationBasename } from "./git-review-code-mutation-helpers.ts";

export function useGitReviewOpenFile(options: {
  readonly context: RendererPluginContext;
  readonly contextId: string;
  readonly gitRootPath?: string;
  readonly itemsRef: RefObject<readonly PierDiffViewItem[]>;
}): (itemId: string) => void {
  const { context, contextId, gitRootPath, itemsRef } = options;
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
      const opened = context.files.openInEditor({
        context: {
          contextId,
          gitRoot: gitRootPath,
          projectRootPath: gitRootPath,
          source: "panel",
          updatedAt: Date.now(),
        },
        path,
        root: gitRootPath,
        title: reviewMutationBasename(path),
      });
      if (!opened) {
        context.notifications.error(
          pluginText(context, "reviewTreeOpenFileFailed", "Unable to open file")
        );
      }
    },
    [context, contextId, gitRootPath, itemsRef]
  );
}
