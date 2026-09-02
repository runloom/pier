import { Button } from "@pier/ui/button.tsx";
import type { PierDiffViewItem } from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  type GitReviewConflictFileActionIntent,
  gitReviewConflictFileActions,
} from "@shared/contracts/git/review.ts";
import type { ReactElement } from "react";
import { pluginText } from "../../plugin-text.ts";

export function fileLevelConflictActionLabel(
  context: RendererPluginContext,
  intent: GitReviewConflictFileActionIntent
): string {
  switch (intent) {
    case "confirm-delete":
      return pluginText(
        context,
        "reviewConflictConfirmDelete",
        "Confirm Delete"
      );
    case "keep-current":
      return pluginText(
        context,
        "reviewConflictKeepCurrent",
        "Keep Current File"
      );
    case "keep-deleted":
      return pluginText(context, "reviewConflictKeepDeleted", "Keep Deleted");
    case "stage-current":
      return pluginText(
        context,
        "reviewConflictStageCurrent",
        "Stage Current File"
      );
    case "take-incoming":
      return pluginText(
        context,
        "reviewConflictTakeIncoming",
        "Use Incoming Version"
      );
    default: {
      const exhaustive: never = intent;
      return exhaustive;
    }
  }
}

/**
 * Modify/delete file-level conflicts: Keep / Take / Delete buttons.
 * Readable worktree text, if any, is rendered beside this card by the host.
 */
export function FileLevelConflictCard(options: {
  readonly busy: boolean;
  readonly conflict: NonNullable<PierDiffViewItem["conflict"]>;
  readonly context: RendererPluginContext;
  readonly itemId: string;
  readonly onResolve: (action: "ours" | "stage" | "theirs") => void;
}): ReactElement | null {
  const { busy, conflict, context, itemId, onResolve } = options;
  if (conflict.contentsDigest.startsWith("estimate:")) {
    return null;
  }
  if (conflict.xy === "AA" || conflict.xy === "UU") {
    return null;
  }
  const fileActions = gitReviewConflictFileActions(conflict.xy);
  if (fileActions.length === 0) {
    return null;
  }
  return (
    <div
      className="flex justify-end gap-2 px-5 py-3"
      data-git-review-conflict-file-level={itemId}
    >
      {fileActions.map((spec) => (
        <Button
          disabled={busy}
          key={spec.action}
          onClick={() => {
            onResolve(spec.action);
          }}
          type="button"
          variant={spec.destructive ? "destructive" : "default"}
        >
          {fileLevelConflictActionLabel(context, spec.intent)}
        </Button>
      ))}
    </div>
  );
}
