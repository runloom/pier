import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitRepoState } from "@shared/contracts/git.ts";
import { pluginText } from "./plugin-text.ts";

/** 浮层行文案注入点：模型层不感知 i18n，测试可注入任意语言。 */
export interface GitStatusDropdownText {
  abortOperation: (operation: string) => string;
  ahead: string;
  authBlocked: string;
  behind: string;
  changes: string;
  conflict: (count: number) => string;
  continueOperation: (operation: string) => string;
  deletions: string;
  detachedBlocked: string;
  fetch: string;
  fetchDetail: string;
  insertions: string;
  largeChange: string;
  merged: string;
  noLocalChanges: string;
  operationName: (kind: Exclude<GitRepoState["kind"], "clean">) => string;
  operationPaused: (operation: string) => string;
  publish: string;
  publishDetail: string;
  pull: string;
  pullBlocked: string;
  push: string;
  republish: string;
  republishDetail: string;
  stash: string;
  sync: string;
  syncUnavailable: string;
}

function defaultOperationName(kind: Exclude<GitRepoState["kind"], "clean">) {
  switch (kind) {
    case "bisecting":
      return "Bisect";
    case "cherry-picking":
      return "Cherry-pick";
    case "merging":
      return "Merge";
    case "rebasing":
      return "Rebase";
    case "reverting":
      return "Revert";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** 英文 fallback（i18n 缺失或测试未注入时）。 */
export const DEFAULT_GIT_STATUS_DROPDOWN_TEXT: GitStatusDropdownText = {
  abortOperation: (operation) => `Abort ${operation}`,
  ahead: "ahead",
  authBlocked:
    "Could not authenticate with the remote. Check credentials, then try again.",
  behind: "behind",
  changes: "Changes",
  conflict: (count) => `${count} ${count === 1 ? "conflict" : "conflicts"}`,
  continueOperation: (operation) => `Continue ${operation}`,
  deletions: "deletions",
  detachedBlocked: "You are not on a branch. Switch to a branch first.",
  fetch: "Fetch",
  fetchDetail: "Refresh remote branch data",
  insertions: "insertions",
  largeChange: "Large change — review before syncing",
  merged: "merged",
  noLocalChanges: "No local changes",
  operationName: defaultOperationName,
  operationPaused: (operation) => `${operation} paused`,
  publish: "Publish Branch",
  publishDetail: "Push to the remote and set the upstream branch",
  pull: "Pull",
  pullBlocked: "Commit or stash local changes before pulling",
  push: "Push",
  republish: "Publish Branch Again",
  republishDetail:
    "The remote branch was deleted. Publish again to recreate it and set upstream.",
  stash: "Stashes",
  sync: "Sync",
  syncUnavailable: "Remote sync is not available right now",
};

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
    abortOperation: (operation) =>
      pluginText(
        pluginContext,
        "statusRowAbortOperation",
        "Abort {{operation}}",
        { operation }
      ),
    ahead: pluginText(pluginContext, "srAhead", "ahead"),
    authBlocked: pluginText(
      pluginContext,
      "statusRowAuthBlocked",
      "Could not authenticate with the remote. Check credentials, then try again."
    ),
    behind: pluginText(pluginContext, "srBehind", "behind"),
    changes: pluginText(pluginContext, "statusRowChanges", "Changes"),
    conflict: (count) =>
      pluginText(
        pluginContext,
        count === 1
          ? "statusDropdownConflictSingle"
          : "statusDropdownConflictPlural",
        count === 1 ? "{{count}} conflict" : "{{count}} conflicts",
        { count }
      ),
    continueOperation: (operation) =>
      pluginText(
        pluginContext,
        "statusRowContinueOperation",
        "Continue {{operation}}",
        { operation }
      ),
    deletions: pluginText(pluginContext, "srDeletions", "deletions"),
    detachedBlocked: pluginText(
      pluginContext,
      "statusRowDetachedBlocked",
      "You are not on a branch. Switch to a branch first."
    ),
    fetch: pluginText(pluginContext, "statusRowFetch", "Fetch"),
    fetchDetail: pluginText(
      pluginContext,
      "statusRowFetchDetail",
      "Refresh remote branch data"
    ),
    insertions: pluginText(pluginContext, "srInsertions", "insertions"),
    largeChange: pluginText(
      pluginContext,
      "statusRowLargeChange",
      "Large change — review before syncing"
    ),
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
    publish: pluginText(pluginContext, "statusRowPublish", "Publish Branch"),
    publishDetail: pluginText(
      pluginContext,
      "statusRowPublishDetail",
      "Push to the remote and set the upstream branch"
    ),
    pull: pluginText(pluginContext, "statusRowPull", "Pull"),
    pullBlocked: pluginText(
      pluginContext,
      "statusRowPullBlocked",
      "Commit or stash local changes before pulling"
    ),
    push: pluginText(pluginContext, "statusRowPush", "Push"),
    republish: pluginText(
      pluginContext,
      "statusRowRepublish",
      "Publish Branch Again"
    ),
    republishDetail: pluginText(
      pluginContext,
      "statusRowRepublishDetail",
      "The remote branch was deleted. Publish again to recreate it and set upstream."
    ),
    stash: pluginText(pluginContext, "statusRowStash", "Stashes"),
    sync: pluginText(pluginContext, "statusRowSync", "Sync"),
    syncUnavailable: pluginText(
      pluginContext,
      "statusRowSyncUnavailable",
      "Remote sync is not available right now"
    ),
  };
}
