import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitRepoState } from "@shared/contracts/git.ts";
import { pluginText } from "./git-plugin-text.ts";
import type { GitStatusDropdownText } from "./git-status-dropdown-model.ts";

function operationName(
  pluginContext: RendererPluginContext,
  kind: Exclude<GitRepoState["kind"], "clean">
): string {
  switch (kind) {
    case "bisecting":
      return pluginText(
        pluginContext,
        "statusDropdownOperationBisect",
        "Bisect"
      );
    case "cherry-picking":
      return pluginText(
        pluginContext,
        "statusDropdownOperationCherryPick",
        "Cherry-pick"
      );
    case "merging":
      return pluginText(pluginContext, "statusDropdownOperationMerge", "Merge");
    case "rebasing":
      return pluginText(
        pluginContext,
        "statusDropdownOperationRebase",
        "Rebase"
      );
    case "reverting":
      return pluginText(
        pluginContext,
        "statusDropdownOperationRevert",
        "Revert"
      );
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function gitStatusDropdownText(
  pluginContext: RendererPluginContext
): GitStatusDropdownText {
  return {
    ahead: pluginText(pluginContext, "srAhead", "ahead"),
    behind: pluginText(pluginContext, "srBehind", "behind"),
    changed: (count) =>
      pluginText(pluginContext, "statusDropdownChanged", "{{count}} changed", {
        count,
      }),
    conflict: (count) =>
      pluginText(
        pluginContext,
        count === 1
          ? "statusDropdownConflictSingle"
          : "statusDropdownConflictPlural",
        count === 1 ? "{{count}} conflict" : "{{count}} conflicts",
        { count }
      ),
    deletions: pluginText(pluginContext, "srDeletions", "deletions"),
    insertions: pluginText(pluginContext, "srInsertions", "insertions"),
    merged: pluginText(pluginContext, "mergedIntoDefault", "merged"),
    noLocalChanges: pluginText(
      pluginContext,
      "statusDropdownNoLocalChanges",
      "No local changes"
    ),
    operationName: (kind) => operationName(pluginContext, kind),
    operationPaused: (operation) =>
      pluginText(
        pluginContext,
        "statusDropdownOperationPaused",
        "{{operation}} paused",
        { operation }
      ),
    upstreamGone: pluginText(pluginContext, "upstreamGone", "upstream gone"),
  };
}
