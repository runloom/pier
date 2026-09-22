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
 * Readable worktree text stays on File. A missing file uses stage blobs.
 */
function conflictActionVariant(
  unreadable: boolean,
  destructive: boolean
): "default" | "destructive" | "outline" {
  if (unreadable) {
    return "outline";
  }
  return destructive ? "destructive" : "default";
}

const UNREADABLE_CONFLICT_PRESENTATION = new Set([
  "invalidEncoding",
  "readError",
  "tooLarge",
]);

export function FileLevelConflictCard(options: {
  readonly busy: boolean;
  readonly conflict: NonNullable<PierDiffViewItem["conflict"]>;
  readonly context: RendererPluginContext;
  readonly itemId: string;
  readonly onOpen?: () => void;
  readonly onResolve: (action: "ours" | "stage" | "theirs") => void;
}): ReactElement | null {
  const { busy, conflict, context, itemId, onOpen, onResolve } = options;
  if (conflict.contentsDigest.startsWith("estimate:")) {
    return null;
  }
  const unreadable = UNREADABLE_CONFLICT_PRESENTATION.has(
    conflict.presentation
  );
  if ((conflict.xy === "AA" || conflict.xy === "UU") && !unreadable) {
    return null;
  }
  const fileActions = gitReviewConflictFileActions(conflict.xy);
  if (fileActions.length === 0 && onOpen === undefined) {
    return null;
  }
  const openButton =
    onOpen === undefined ? null : (
      <Button
        data-git-review-conflict-open=""
        disabled={busy}
        onClick={onOpen}
        type="button"
        variant={unreadable ? "default" : "outline"}
      >
        {pluginText(context, "reviewOpenFile", "Open File")}
      </Button>
    );
  return (
    <div
      className="flex justify-end gap-2 px-5 py-3"
      data-git-review-conflict-file-level={itemId}
    >
      {unreadable ? null : openButton}
      {fileActions.map((spec) => (
        <Button
          disabled={busy}
          key={spec.action}
          onClick={() => {
            onResolve(spec.action);
          }}
          type="button"
          variant={conflictActionVariant(unreadable, spec.destructive)}
        >
          {fileLevelConflictActionLabel(context, spec.intent)}
        </Button>
      ))}
      {unreadable ? openButton : null}
    </div>
  );
}
