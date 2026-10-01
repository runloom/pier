import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewConflictFileActionIntent } from "@shared/contracts/git/review.ts";
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
