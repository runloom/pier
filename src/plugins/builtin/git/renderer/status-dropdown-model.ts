import type {
  GitChangeSummary,
  GitCounts,
  GitRepoState,
  GitStatus,
} from "@shared/contracts/git.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { GitStatusDropdownText } from "./status-dropdown-text.ts";
import { DEFAULT_GIT_STATUS_DROPDOWN_TEXT } from "./status-dropdown-text.ts";

export type { GitStatusDropdownText } from "./status-dropdown-text.ts";

/**
 * 浮层三区模型（v2 金标准方案）：
 * 1. 身份区 — 分支名 + 工作树/fetch 上下文行（组件层渲染，不进 rows）。
 * 2. 情境区 rows — 只在对应事实存在时出现的行：冲突/暂停操作（置顶，
 *    含继续/中止）、更改（含大变更提级）、同步、储藏计数、生命周期灰化
 *    信息行（merged / upstream gone / no upstream）、clean 单行。
 * 3. 固定任务区 tasks — 永远存在的导航动作（切换分支 / 切换工作树）。
 */
export type GitStatusDropdownActionId =
  | "abortOperation"
  | "continueOperation"
  | "pull"
  | "push"
  | "switchBranch"
  | "switchWorktree"
  | "syncChanges"
  | "viewChanges";

export type GitStatusDropdownVariant = "loading" | "normal" | "unavailable";

export type GitStatusDropdownRowTone =
  | "danger"
  | "default"
  | "muted"
  | "warning";

export type GitStatusDropdownRowIcon =
  | "abort"
  | "bisect"
  | "changed"
  | "cherryPick"
  | "clean"
  | "continue"
  | "merge"
  | "merged"
  | "pull"
  | "push"
  | "rebase"
  | "revert"
  | "stash"
  | "sync"
  | "upstreamGone";

export type GitStatusDropdownRowId =
  | "abortOperation"
  | "changes"
  | "clean"
  | "continueOperation"
  | "merged"
  | "noUpstream"
  | "operation"
  | "stash"
  | "status"
  | "sync"
  | "upstreamGone";

export interface GitStatusDropdownRow {
  /** null = 信息行（灰化、不可点）。 */
  action: GitStatusDropdownActionId | null;
  /** sr-only 补充（± 行含义、领先/落后方向）。 */
  assistiveLabel?: string;
  icon?: GitStatusDropdownRowIcon;
  id: GitStatusDropdownRowId;
  label: string;
  /** tooltip：fetch 快照 caveat、大变更提示、拉取被本地改动阻塞的原因。 */
  title?: string;
  tone: GitStatusDropdownRowTone;
  /** 行尾数值（计数 / ± / ↑↓），组件层右对齐 tabular-nums。 */
  value?: string;
}

export interface GitStatusDropdownAction {
  id: GitStatusDropdownActionId;
}

/** 可从浮层收敛的暂停操作（bisect 由终端主导，不提供继续/中止）。 */
export type GitStatusDropdownOperationKind = Exclude<
  GitRepoState["kind"],
  "bisecting" | "clean"
>;

export interface GitStatusDropdownModel {
  branchLabel: string;
  contextLine: string;
  /** 非 null 时情境区含继续/中止行，供动作层解析 runner。 */
  operationKind: GitStatusDropdownOperationKind | null;
  rows: GitStatusDropdownRow[];
  tasks: GitStatusDropdownAction[];
  variant: GitStatusDropdownVariant;
  worktreePath: string;
}

export interface GitStatusDropdownModelOptions {
  fallbackWorktreeName: string;
  remoteSyncLabel?: null | string;
  text?: GitStatusDropdownText;
  worktreePath: string;
}

/**
 * 大变更提级阈值（Pier 差异化：AI 智能体一次改动上百文件是常态）。
 * 任一超阈值即把「更改」行提级为 warning 并附 tooltip。
 */
export const GIT_LARGE_CHANGE_FILE_THRESHOLD = 50;
export const GIT_LARGE_CHANGE_LINE_THRESHOLD = 1000;

const EMPTY_COUNTS: GitCounts = {
  conflict: 0,
  modified: 0,
  staged: 0,
  untracked: 0,
};

const LINE_DELETION_SIGN = "\u2212";

function hasLineDelta(
  summary: GitChangeSummary
): summary is Extract<GitChangeSummary, { kind: "lineDelta" }> {
  return summary.kind === "lineDelta";
}

function operationIcon(
  kind: Exclude<GitRepoState["kind"], "clean">
): GitStatusDropdownRowIcon {
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

function conflictCount(repoState: GitRepoState, counts: GitCounts): number {
  if ("conflictCount" in repoState) {
    return repoState.conflictCount;
  }
  return counts.conflict;
}

function canUseUpstream(status: GitStatus): boolean {
  return (
    status.branch.upstream !== null &&
    !status.branch.upstreamGone &&
    status.remoteSync?.state !== "authRequired"
  );
}

export function isSyncUncertain(status: GitStatus): boolean {
  return (
    status.remoteSync?.state === "authRequired" ||
    status.remoteSync?.lastSuccessAt === null
  );
}

/**
 * 远端同步动作解析（状态栏同步项与浮层同步行共用）：
 * behind 且有本地改动时禁用 pull/sync（避免打断本地工作）。
 */
export function resolveRemoteSyncActionId(
  status: GitStatus
): "pull" | "push" | "syncChanges" | null {
  if (!canUseUpstream(status)) {
    return null;
  }
  const { ahead, behind } = status.branch;
  if (ahead === 0 && behind === 0) {
    return null;
  }
  const hasLocalChanges = status.changeSummary.changedFiles > 0;
  if (behind > 0 && hasLocalChanges) {
    return null;
  }
  if (ahead > 0 && behind > 0) {
    return "syncChanges";
  }
  if (ahead > 0) {
    return "push";
  }
  return "pull";
}

function formatSyncValue(ahead: number, behind: number): string {
  const parts: string[] = [];
  if (ahead > 0) {
    parts.push(`↑${ahead}`);
  }
  if (behind > 0) {
    parts.push(`↓${behind}`);
  }
  return parts.join(" ");
}

function syncAssistiveLabel(
  status: GitStatus,
  text: GitStatusDropdownText
): string {
  const parts: string[] = [];
  if (status.branch.ahead > 0) {
    parts.push(`${status.branch.ahead} ${text.ahead}`);
  }
  if (status.branch.behind > 0) {
    parts.push(`${status.branch.behind} ${text.behind}`);
  }
  return parts.join(", ");
}

function isLargeChange(summary: GitChangeSummary): boolean {
  if (summary.changedFiles >= GIT_LARGE_CHANGE_FILE_THRESHOLD) {
    return true;
  }
  return Boolean(
    summary.kind === "lineDelta" &&
      summary.insertions + summary.deletions >= GIT_LARGE_CHANGE_LINE_THRESHOLD
  );
}

function operationRows(
  repoState: Extract<
    GitRepoState,
    { kind: Exclude<GitRepoState["kind"], "clean"> }
  >,
  counts: GitCounts,
  text: GitStatusDropdownText
): GitStatusDropdownRow[] {
  const operation = text.operationName(repoState.kind);
  const conflicts = conflictCount(repoState, counts);
  const rows: GitStatusDropdownRow[] = [
    {
      action: "viewChanges",
      icon: operationIcon(repoState.kind),
      id: "operation",
      label: text.operationPaused(operation),
      tone: conflicts > 0 ? "danger" : "default",
      ...(conflicts > 0 ? { value: text.conflict(conflicts) } : {}),
    },
  ];
  if (repoState.kind === "bisecting") {
    return rows;
  }
  if (repoState.kind !== "merging") {
    rows.push({
      action: "continueOperation",
      icon: "continue",
      id: "continueOperation",
      label: text.continueOperation(operation),
      tone: "default",
    });
  }
  rows.push({
    action: "abortOperation",
    icon: "abort",
    id: "abortOperation",
    label: text.abortOperation(operation),
    tone: "default",
  });
  return rows;
}

function changesRow(
  status: GitStatus,
  text: GitStatusDropdownText
): GitStatusDropdownRow {
  const summary = status.changeSummary;
  const deltaValue = hasLineDelta(summary)
    ? ` · +${summary.insertions} ${LINE_DELETION_SIGN}${summary.deletions}`
    : "";
  const large = isLargeChange(summary);
  return {
    action: "viewChanges",
    icon: "changed",
    id: "changes",
    label: text.changes,
    tone: large ? "warning" : "default",
    value: `${summary.changedFiles}${deltaValue}`,
    ...(hasLineDelta(summary)
      ? {
          assistiveLabel: `${summary.insertions} ${text.insertions}, ${summary.deletions} ${text.deletions}`,
        }
      : {}),
    ...(large ? { title: text.largeChange } : {}),
  };
}

function syncRow(
  status: GitStatus,
  text: GitStatusDropdownText,
  remoteSyncLabel: null | string
): GitStatusDropdownRow | null {
  const { ahead, behind } = status.branch;
  if (ahead === 0 && behind === 0) {
    return null;
  }
  const actionId = resolveRemoteSyncActionId(status);
  const value = formatSyncValue(ahead, behind);
  const assistiveLabel = syncAssistiveLabel(status, text);
  const caveat =
    isSyncUncertain(status) && remoteSyncLabel ? remoteSyncLabel : null;
  if (actionId === null) {
    const blockedByLocalChanges =
      canUseUpstream(status) &&
      behind > 0 &&
      status.changeSummary.changedFiles > 0;
    const title = blockedByLocalChanges ? text.pullBlocked : caveat;
    return {
      action: null,
      assistiveLabel,
      icon: "sync",
      id: "sync",
      label: text.sync,
      tone: "muted",
      value,
      ...(title ? { title } : {}),
    };
  }
  const labels = {
    pull: text.pull,
    push: text.push,
    syncChanges: text.sync,
  } as const;
  const icons = {
    pull: "pull",
    push: "push",
    syncChanges: "sync",
  } as const satisfies Record<string, GitStatusDropdownRowIcon>;
  return {
    action: actionId,
    assistiveLabel,
    icon: icons[actionId],
    id: "sync",
    label: labels[actionId],
    tone: "default",
    value,
    ...(caveat ? { title: caveat } : {}),
  };
}

/** 生命周期灰化信息行：merged / upstream gone / no upstream。 */
function lifecycleRows(
  status: GitStatus,
  text: GitStatusDropdownText
): GitStatusDropdownRow[] {
  const rows: GitStatusDropdownRow[] = [];
  if (status.branch.mergedIntoDefault === true) {
    rows.push({
      action: null,
      icon: "merged",
      id: "merged",
      label: text.merged,
      tone: "muted",
    });
  }
  if (status.branch.upstreamGone) {
    rows.push({
      action: null,
      icon: "upstreamGone",
      id: "upstreamGone",
      label: text.upstreamGone,
      tone: "muted",
    });
  } else if (status.branch.branch !== null && status.branch.upstream === null) {
    rows.push({
      action: null,
      id: "noUpstream",
      label: text.noUpstream,
      tone: "muted",
    });
  }
  return rows;
}

function stashRow(
  status: GitStatus,
  text: GitStatusDropdownText
): GitStatusDropdownRow | null {
  if (status.stashCount === 0) {
    return null;
  }
  return {
    action: null,
    icon: "stash",
    id: "stash",
    label: text.stash,
    tone: "muted",
    value: String(status.stashCount),
  };
}

function contextLine(
  options: GitStatusDropdownModelOptions,
  status: GitStatus
): string {
  const hasSyncCounts = status.branch.ahead > 0 || status.branch.behind > 0;
  // ↑/↓ 已在同步行携带 fetch caveat 时，上下文行不再重复。
  const syncLabel =
    isSyncUncertain(status) && hasSyncCounts
      ? null
      : (options.remoteSyncLabel ?? null);
  return [options.fallbackWorktreeName, syncLabel].filter(Boolean).join(" · ");
}

const FIXED_TASKS: GitStatusDropdownAction[] = [
  { id: "switchBranch" },
  { id: "switchWorktree" },
];

export function deriveGitStatusDropdownModel(
  status: GitStatus,
  context: PanelContext,
  options: GitStatusDropdownModelOptions
): GitStatusDropdownModel {
  const counts = status.counts ?? EMPTY_COUNTS;
  const text = options.text ?? DEFAULT_GIT_STATUS_DROPDOWN_TEXT;
  const branchLabel =
    status.branch.branch ?? context.branch ?? options.fallbackWorktreeName;
  const remoteSyncLabel = options.remoteSyncLabel ?? null;

  const rows: GitStatusDropdownRow[] = [];
  let operationKind: GitStatusDropdownOperationKind | null = null;

  if (status.repoState.kind !== "clean") {
    rows.push(...operationRows(status.repoState, counts, text));
    if (status.repoState.kind !== "bisecting") {
      operationKind = status.repoState.kind;
    }
  } else if (status.changeSummary.changedFiles > 0) {
    rows.push(changesRow(status, text));
  } else {
    rows.push({
      action: null,
      icon: "clean",
      id: "clean",
      label: text.noLocalChanges,
      tone: "muted",
    });
  }

  // 阻塞操作期间隐藏同步行：sync/pull/push 与暂停操作互斥。
  if (status.repoState.kind === "clean") {
    const sync = syncRow(status, text, remoteSyncLabel);
    if (sync) {
      rows.push(sync);
    }
  }

  const stash = stashRow(status, text);
  if (stash) {
    rows.push(stash);
  }
  rows.push(...lifecycleRows(status, text));

  return {
    branchLabel,
    contextLine: contextLine(options, status),
    operationKind,
    rows,
    tasks: FIXED_TASKS.map((task) => ({ ...task })),
    variant: "normal",
    worktreePath: options.worktreePath,
  };
}
