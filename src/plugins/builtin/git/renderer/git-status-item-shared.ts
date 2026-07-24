import type {
  RendererPluginContext,
  RendererTerminalStatusItemContext,
} from "@plugins/api/renderer.ts";
import type {
  GitCounts,
  GitRemoteSync,
  GitRepoState,
  GitStatus,
} from "@shared/contracts/git.ts";
import { useEffect, useState } from "react";
import { pluginText } from "./git-plugin-text.ts";
import {
  type BranchIconKind,
  repoOperationHasConflicts,
} from "./git-status-parts.tsx";

const PATH_SEPARATOR_RE = /[\\/]/;

export const SHOW_DIRTY_INDICATOR_KEY =
  "pier.git.statusItem.showDirtyIndicator";
export const SHOW_CHANGES_STATUS_KEY = "pier.git.statusItem.showChangesStatus";
export const SHOW_SYNC_STATUS_KEY = "pier.git.statusItem.showSyncStatus";

export interface StatusFlags {
  ahead: number;
  behind: number;
  counts: GitCounts;
  hasRepoState: boolean;
  hasSync: boolean;
  hasWorkingChanges: boolean;
  isDistinctWorktree: boolean;
  repoState: GitRepoState;
}

export function basename(path: null | string | undefined): string {
  if (!path) {
    return "";
  }
  const parts = path.split(PATH_SEPARATOR_RE).filter(Boolean);
  return parts.at(-1) ?? path;
}

export function remoteSyncLine(
  pluginContext: RendererPluginContext,
  remoteSync: GitRemoteSync | null
): string | null {
  if (remoteSync === null) {
    return null;
  }
  if (remoteSync.state === "fetching") {
    return pluginText(pluginContext, "remoteSyncFetching", "Fetching remote…");
  }
  if (remoteSync.state === "authRequired") {
    return pluginText(
      pluginContext,
      "remoteSyncAuthPaused",
      "Auto-fetch paused: authentication failed"
    );
  }
  if (remoteSync.lastSuccessAt === null) {
    return pluginText(
      pluginContext,
      "remoteSyncNever",
      "Remote not fetched yet"
    );
  }
  const minutes = Math.max(
    0,
    Math.round((Date.now() - remoteSync.lastSuccessAt) / 60_000)
  );
  if (minutes === 0) {
    return pluginText(
      pluginContext,
      "remoteSyncJustNow",
      "Remote fetched just now"
    );
  }
  return pluginText(
    pluginContext,
    "remoteSyncAgo",
    "Remote fetched {{minutes}} min ago",
    {
      minutes,
    }
  );
}

export function useBooleanSetting(
  pluginContext: RendererPluginContext,
  key: string
): boolean {
  const [value, setValue] = useState<boolean>(() =>
    pluginContext.configuration.get<boolean>(key)
  );
  useEffect(
    () =>
      pluginContext.configuration.onDidChange((event) => {
        if (event.affectsConfiguration(key)) {
          setValue(pluginContext.configuration.get<boolean>(key));
        }
      }),
    [pluginContext, key]
  );
  return value;
}

export function deriveStatusFlags(
  status: GitStatus | null,
  context: RendererTerminalStatusItemContext["context"]
): StatusFlags {
  const counts = status?.counts ?? {
    conflict: 0,
    modified: 0,
    staged: 0,
    untracked: 0,
  };
  const repoState: GitRepoState = status?.repoState ?? { kind: "clean" };
  const ahead = status?.branch?.ahead ?? 0;
  const behind = status?.branch?.behind ?? 0;
  const totalChanges =
    counts.staged + counts.modified + counts.untracked + counts.conflict;
  return {
    ahead,
    behind,
    counts,
    hasRepoState: repoState.kind !== "clean",
    hasSync: ahead > 0 || behind > 0,
    hasWorkingChanges: totalChanges > 0,
    isDistinctWorktree: Boolean(
      context?.worktreeRoot && context.worktreeRoot !== context.gitRoot
    ),
    repoState,
  };
}

export function deriveBranchIconKind(
  flags: StatusFlags,
  showDirtyIndicator: boolean
): BranchIconKind {
  const hasConflicts =
    flags.counts.conflict > 0 || repoOperationHasConflicts(flags.repoState);
  if (hasConflicts) {
    return "conflict";
  }
  if (!showDirtyIndicator) {
    return "clean";
  }
  if (flags.counts.staged > 0) {
    return "staged";
  }
  if (flags.hasWorkingChanges) {
    return "dirty";
  }
  return "clean";
}

export function isGitStatusBarVisible(
  panelContext: RendererTerminalStatusItemContext["context"]
): boolean {
  return Boolean(
    panelContext?.worktreeRoot ??
      (panelContext?.worktreeSupported === false
        ? undefined
        : panelContext?.gitRoot)
  );
}

export function isStatusItemSettingEnabled(
  pluginContext: RendererPluginContext,
  key: string
): boolean {
  return pluginContext.configuration.get<boolean>(key) !== false;
}
