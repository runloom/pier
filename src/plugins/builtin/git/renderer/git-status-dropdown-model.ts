import type {
  GitCounts,
  GitDelta,
  GitRepoState,
  GitStatus,
} from "@shared/contracts/git.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";

export type GitStatusDropdownActionId =
  | "pull"
  | "push"
  | "switchBranch"
  | "switchWorktree"
  | "syncChanges"
  | "viewChanges";

export type GitStatusDropdownVariant =
  | "active"
  | "clean"
  | "completed"
  | "dirty"
  | "loading"
  | "unavailable";

export type GitStatusDropdownSummaryTone =
  | "danger"
  | "default"
  | "destructive"
  | "done"
  | "info"
  | "muted"
  | "success"
  | "warning";

export type GitStatusDropdownSummaryIcon =
  | "ahead"
  | "behind"
  | "bisect"
  | "changed"
  | "cherryPick"
  | "clean"
  | "conflict"
  | "merge"
  | "merged"
  | "rebase"
  | "revert"
  | "upstreamGone";

export interface GitStatusDropdownAction {
  id: GitStatusDropdownActionId;
}

export interface GitStatusDropdownSummaryPart {
  assistiveLabel?: string;
  icon?: GitStatusDropdownSummaryIcon;
  label: string;
  tone: GitStatusDropdownSummaryTone;
}

export interface GitStatusDropdownSummaryGroup {
  parts: GitStatusDropdownSummaryPart[];
  /** Fetch freshness caveat when ahead/behind may be stale. */
  title?: string;
}

export interface GitStatusDropdownModel {
  actions: GitStatusDropdownAction[];
  branchLabel: string;
  contextLine: string;
  statusGroups: GitStatusDropdownSummaryGroup[];
  variant: GitStatusDropdownVariant;
  worktreePath: string;
}

export interface GitStatusDropdownText {
  ahead: string;
  behind: string;
  changed: (count: number) => string;
  conflict: (count: number) => string;
  deletions: string;
  insertions: string;
  merged: string;
  noLocalChanges: string;
  operationName: (kind: Exclude<GitRepoState["kind"], "clean">) => string;
  operationPaused: (operation: string) => string;
  upstreamGone: string;
}

export interface GitStatusDropdownModelOptions {
  fallbackWorktreeName: string;
  remoteSyncLabel?: null | string;
  text?: GitStatusDropdownText;
  worktreePath: string;
}

const EMPTY_COUNTS: GitCounts = {
  conflict: 0,
  modified: 0,
  staged: 0,
  untracked: 0,
};

const ACTIONS = {
  pull: {
    id: "pull",
  },
  push: {
    id: "push",
  },
  switchBranch: {
    id: "switchBranch",
  },
  switchWorktree: {
    id: "switchWorktree",
  },
  syncChanges: {
    id: "syncChanges",
  },
  viewChanges: {
    id: "viewChanges",
  },
} as const satisfies Record<GitStatusDropdownActionId, GitStatusDropdownAction>;

function action(id: GitStatusDropdownActionId): GitStatusDropdownAction {
  return { ...ACTIONS[id] };
}

const DEFAULT_TEXT: GitStatusDropdownText = {
  ahead: "ahead",
  behind: "behind",
  changed: (count) => `${count} changed`,
  conflict: (count) => `${count} ${count === 1 ? "conflict" : "conflicts"}`,
  deletions: "deletions",
  insertions: "insertions",
  merged: "merged",
  noLocalChanges: "No local changes",
  operationName: activeOperationName,
  operationPaused: (operation) => `${operation} paused`,
  upstreamGone: "upstream gone",
};

const LINE_DELETION_SIGN = "\u2212";

function totalChanges(counts: GitCounts): number {
  return counts.conflict + counts.modified + counts.staged + counts.untracked;
}

function hasLineDelta(delta: GitDelta | null): boolean {
  return Boolean(delta && (delta.insertions > 0 || delta.deletions > 0));
}

function summaryGroup(
  ...parts: GitStatusDropdownSummaryPart[]
): GitStatusDropdownSummaryGroup {
  return { parts };
}

function operationIcon(
  kind: Exclude<GitRepoState["kind"], "clean">
): GitStatusDropdownSummaryIcon {
  switch (kind) {
    case "bisecting":
      return "bisect";
    case "cherry-picking":
      return "cherryPick";
    case "merging":
      return "merge";
    case "rebasing":
      return "rebase";
    case "reverting":
      return "revert";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function formatDeltaGroup(
  delta: GitDelta | null,
  text: GitStatusDropdownText
): GitStatusDropdownSummaryGroup | null {
  if (delta === null || !hasLineDelta(delta)) {
    return null;
  }
  return summaryGroup(
    {
      assistiveLabel: text.insertions,
      label: `+${delta.insertions}`,
      tone: "success",
    },
    {
      assistiveLabel: text.deletions,
      label: `${LINE_DELETION_SIGN}${delta.deletions}`,
      tone: "destructive",
    }
  );
}

function formatSyncGroup(
  status: GitStatus,
  text: GitStatusDropdownText,
  remoteSyncLabel?: null | string
): GitStatusDropdownSummaryGroup | null {
  const ahead = status.branch.ahead;
  const behind = status.branch.behind;
  if (ahead === 0 && behind === 0) {
    return null;
  }
  const parts: GitStatusDropdownSummaryPart[] = [];
  if (ahead > 0) {
    parts.push({
      assistiveLabel: text.ahead,
      icon: "ahead",
      label: `↑${ahead}`,
      tone: "muted",
    });
  }
  if (behind > 0) {
    parts.push({
      assistiveLabel: text.behind,
      icon: "behind",
      label: `↓${behind}`,
      tone: "muted",
    });
  }
  const uncertain =
    status.remoteSync?.state === "authRequired" ||
    status.remoteSync?.lastSuccessAt === null;
  const group = summaryGroup(...parts);
  if (uncertain && remoteSyncLabel) {
    return { ...group, title: remoteSyncLabel };
  }
  return group;
}

function canUseUpstream(status: GitStatus): boolean {
  return (
    status.branch.upstream !== null &&
    !status.branch.upstreamGone &&
    status.remoteSync?.state !== "authRequired"
  );
}

function remoteSyncAction(
  status: GitStatus,
  counts: GitCounts
): GitStatusDropdownAction | null {
  if (!canUseUpstream(status)) {
    return null;
  }
  const { ahead, behind } = status.branch;
  if (ahead === 0 && behind === 0) {
    return null;
  }
  const hasLocalChanges =
    totalChanges(counts) > 0 || hasLineDelta(status.delta);
  if (behind > 0 && hasLocalChanges) {
    return null;
  }
  if (ahead > 0 && behind > 0) {
    return action("syncChanges");
  }
  if (ahead > 0) {
    return action("push");
  }
  return action("pull");
}

function conflictCount(repoState: GitRepoState, counts: GitCounts): number {
  if ("conflictCount" in repoState) {
    return repoState.conflictCount;
  }
  return counts.conflict;
}

function activeOperationName(kind: Exclude<GitRepoState["kind"], "clean">) {
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

function activeStatusGroups(
  repoState: Extract<
    GitRepoState,
    { kind: Exclude<GitRepoState["kind"], "clean"> }
  >,
  counts: GitCounts,
  text: GitStatusDropdownText
): GitStatusDropdownSummaryGroup[] {
  const conflicts = conflictCount(repoState, counts);
  const groups = [
    summaryGroup({
      icon: operationIcon(repoState.kind),
      label: text.operationPaused(text.operationName(repoState.kind)),
      tone: "info",
    }),
  ];
  if (conflicts > 0) {
    groups.push(
      summaryGroup({
        icon: "conflict",
        label: text.conflict(conflicts),
        tone: "danger",
      })
    );
  }
  return groups;
}

function dirtySummaryGroups(
  status: GitStatus,
  text: GitStatusDropdownText,
  remoteSyncLabel?: null | string
): GitStatusDropdownSummaryGroup[] {
  const pieces = [
    summaryGroup({
      icon: "changed",
      label: text.changed(totalChanges(status.counts)),
      tone: "warning",
    }),
  ];
  const delta = formatDeltaGroup(status.delta, text);
  const sync = formatSyncGroup(status, text, remoteSyncLabel);
  if (delta) {
    pieces.push(delta);
  }
  if (sync) {
    pieces.push(sync);
  }
  return pieces;
}

function cleanStatusGroups(
  status: GitStatus,
  text: GitStatusDropdownText,
  remoteSyncLabel?: null | string
): GitStatusDropdownSummaryGroup[] {
  const parts = [
    summaryGroup({
      icon: "clean",
      label: text.noLocalChanges,
      tone: "default",
    }),
  ];
  const sync = formatSyncGroup(status, text, remoteSyncLabel);
  if (sync) {
    parts.push(sync);
  }
  if (status.branch.mergedIntoDefault === true) {
    parts.push(
      summaryGroup({ icon: "merged", label: text.merged, tone: "done" })
    );
  }
  if (status.branch.upstreamGone) {
    parts.push(
      summaryGroup({
        icon: "upstreamGone",
        label: text.upstreamGone,
        tone: "warning",
      })
    );
  }
  return parts;
}

function contextLine(
  options: GitStatusDropdownModelOptions,
  status: GitStatus
): string {
  const uncertain =
    status.remoteSync?.state === "authRequired" ||
    status.remoteSync?.lastSuccessAt === null;
  const hasSyncCounts = status.branch.ahead > 0 || status.branch.behind > 0;
  // When ↑/↓ already carry the fetch caveat as a title, don't repeat it here.
  const syncLabel =
    uncertain && hasSyncCounts ? null : (options.remoteSyncLabel ?? null);
  return [options.fallbackWorktreeName, syncLabel].filter(Boolean).join(" · ");
}

export function deriveGitStatusDropdownModel(
  status: GitStatus,
  context: PanelContext,
  options: GitStatusDropdownModelOptions
): GitStatusDropdownModel {
  const counts = status.counts ?? EMPTY_COUNTS;
  const text = options.text ?? DEFAULT_TEXT;
  const branchLabel =
    status.branch.branch ?? context.branch ?? options.fallbackWorktreeName;
  const remoteSyncLabel = options.remoteSyncLabel ?? null;
  const base = {
    branchLabel,
    contextLine: contextLine(options, status),
    worktreePath: options.worktreePath,
  };

  if (status.repoState.kind !== "clean") {
    const statusGroups = activeStatusGroups(status.repoState, counts, text);
    return {
      ...base,
      actions: [action("viewChanges"), action("switchWorktree")],
      statusGroups,
      variant: "active",
    };
  }

  if (totalChanges(counts) > 0 || hasLineDelta(status.delta)) {
    const statusGroups = dirtySummaryGroups(status, text, remoteSyncLabel);
    const syncAction = remoteSyncAction(status, counts);
    return {
      ...base,
      actions: [
        action("viewChanges"),
        ...(syncAction ? [syncAction] : []),
        action("switchWorktree"),
      ],
      statusGroups,
      variant: "dirty",
    };
  }

  const completed =
    status.branch.mergedIntoDefault === true || status.branch.upstreamGone;
  if (completed) {
    const statusGroups = cleanStatusGroups(status, text, remoteSyncLabel);
    const syncAction = remoteSyncAction(status, counts);
    return {
      ...base,
      actions: syncAction
        ? [syncAction, action("switchBranch"), action("switchWorktree")]
        : [action("switchBranch"), action("switchWorktree")],
      statusGroups,
      variant: "completed",
    };
  }

  const statusGroups = cleanStatusGroups(status, text, remoteSyncLabel);
  const syncAction = remoteSyncAction(status, counts);
  return {
    ...base,
    actions: [
      ...(syncAction ? [syncAction] : []),
      action("switchBranch"),
      action("switchWorktree"),
    ],
    statusGroups,
    variant: "clean",
  };
}
