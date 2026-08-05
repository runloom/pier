import type {
  GitChangeSummary,
  GitCounts,
  GitRepoState,
  GitStatus,
} from "@shared/contracts/git.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  isSyncUncertain,
  type RemoteSyncBlockReason,
  resolveRemoteSyncDecision,
} from "./remote-sync-policy.ts";
import type { GitStatusDropdownText } from "./status-dropdown-text.ts";
import { DEFAULT_GIT_STATUS_DROPDOWN_TEXT } from "./status-dropdown-text.ts";

export {
  canPublishBranch,
  isSyncUncertain,
  type RemoteSyncActionId,
  type RemoteSyncBlockReason,
  resolveRemoteSyncActionId,
  resolveRemoteSyncBlockReason,
  resolveRemoteSyncDecision,
} from "./remote-sync-policy.ts";
export type { GitStatusDropdownText } from "./status-dropdown-text.ts";

/**
 * 浮层三区模型（v2 金标准方案）：
 * 1. 身份区 — 分支名 + 工作树/fetch 上下文行（组件层渲染，不进 rows）。
 * 2. 情境区 rows — 只在对应事实存在时出现的行：冲突/暂停操作（置顶，
 *    含继续/中止）、更改（含大变更提级）、同步、储藏计数、生命周期灰化
 *    信息行（merged）、clean 单行。上游已删走「重新发布」主动作。
 * 3. 固定任务区 tasks — 获取远程更新 / 切换分支 / 切换工作树。
 */
export type GitStatusDropdownActionId =
  | "abortOperation"
  | "continueOperation"
  | "fetch"
  | "publish"
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
  | "fetch"
  | "merge"
  | "merged"
  | "publish"
  | "pull"
  | "push"
  | "rebase"
  | "revert"
  | "stash"
  | "sync";

export type GitStatusDropdownRowId =
  | "abortOperation"
  | "changes"
  | "clean"
  | "continueOperation"
  | "merged"
  | "operation"
  | "stash"
  | "status"
  | "sync";

/** 更改行 ± 行增量；与 value（文件数）分字段，组件按 diff 语义色渲染。 */
export interface GitStatusDropdownLineDelta {
  deletions: number;
  insertions: number;
}

export interface GitStatusDropdownRow {
  /** null = 信息行（灰化、不可点）。 */
  action: GitStatusDropdownActionId | null;
  /** sr-only 补充（± 行含义、领先/落后方向）。 */
  assistiveLabel?: string;
  icon?: GitStatusDropdownRowIcon;
  id: GitStatusDropdownRowId;
  label: string;
  /** 可见行增量；组件渲染 `value · +ins −del` 并为 ± 上色。 */
  lineDelta?: GitStatusDropdownLineDelta;
  /** tooltip：fetch caveat、大变更提示、拉取被本地改动阻塞的原因。 */
  title?: string;
  tone: GitStatusDropdownRowTone;
  /** 行尾数值（文件数 / ↑↓ / 冲突）；有 lineDelta 时只含文件数。 */
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
  /** 远程动作 cwd：git root（与 palette / busy 一致）。 */
  gitRoot: string;
  /** 非 null 时情境区含继续/中止行，供动作层解析 runner。 */
  operationKind: GitStatusDropdownOperationKind | null;
  rows: GitStatusDropdownRow[];
  tasks: GitStatusDropdownAction[];
  variant: GitStatusDropdownVariant;
}

export interface GitStatusDropdownModelOptions {
  fallbackWorktreeName: string;
  gitRoot: string;
  remoteSyncLabel?: null | string;
  text?: GitStatusDropdownText;
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

function hasVisibleLineDelta(
  summary: GitChangeSummary
): summary is Extract<GitChangeSummary, { kind: "lineDelta" }> {
  return (
    summary.kind === "lineDelta" &&
    (summary.insertions > 0 || summary.deletions > 0)
  );
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
    hasVisibleLineDelta(summary) &&
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
  const large = isLargeChange(summary);
  const visibleDelta = hasVisibleLineDelta(summary);
  return {
    action: "viewChanges",
    icon: "changed",
    id: "changes",
    label: text.changes,
    tone: large ? "warning" : "default",
    value: String(summary.changedFiles),
    ...(visibleDelta
      ? {
          assistiveLabel: `${summary.insertions} ${text.insertions}, ${summary.deletions} ${text.deletions}`,
          lineDelta: {
            deletions: summary.deletions,
            insertions: summary.insertions,
          },
        }
      : {}),
    ...(large ? { title: text.largeChange } : {}),
  };
}

function blockReasonTitle(
  reason: RemoteSyncBlockReason,
  text: GitStatusDropdownText
): string {
  switch (reason) {
    case "authRequired":
      return text.authBlocked;
    case "detached":
      return text.detachedBlocked;
    case "pullBlocked":
      return text.pullBlocked;
    default:
      return text.syncUnavailable;
  }
}

/**
 * 同步情境行：只展示 publish / push / pull / sync 与阻塞态。
 * 已同步时的 fetch 只走固定任务区，避免双入口。
 */
function syncRow(
  status: GitStatus,
  text: GitStatusDropdownText,
  remoteSyncLabel: null | string
): GitStatusDropdownRow | null {
  const { ahead, behind } = status.branch;
  const decision = resolveRemoteSyncDecision(status);
  if (decision.kind === "action" && decision.action === "publish") {
    const republish = status.branch.upstreamGone;
    return {
      action: "publish",
      icon: "publish",
      id: "sync",
      label: republish ? text.republish : text.publish,
      title: republish ? text.republishDetail : text.publishDetail,
      tone: "default",
    };
  }
  // fetch 由 FIXED_TASKS 承担
  if (decision.kind === "action" && decision.action === "fetch") {
    return null;
  }
  const value =
    ahead > 0 || behind > 0 ? formatSyncValue(ahead, behind) : undefined;
  const assistiveLabel =
    ahead > 0 || behind > 0 ? syncAssistiveLabel(status, text) : undefined;
  const caveat =
    isSyncUncertain(status) && remoteSyncLabel ? remoteSyncLabel : null;
  if (decision.kind === "blocked") {
    if (ahead === 0 && behind === 0) {
      return null;
    }
    const title = blockReasonTitle(decision.reason, text);
    return {
      action: null,
      icon: "sync",
      id: "sync",
      label: text.sync,
      title,
      tone: "muted",
      ...(assistiveLabel ? { assistiveLabel } : {}),
      ...(value ? { value } : {}),
    };
  }
  // publish / fetch 已提前返回
  const actionId = decision.action;
  if (
    actionId !== "pull" &&
    actionId !== "push" &&
    actionId !== "syncChanges"
  ) {
    return null;
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
    icon: icons[actionId],
    id: "sync",
    label: labels[actionId],
    tone: "default",
    ...(assistiveLabel ? { assistiveLabel } : {}),
    ...(value ? { value } : {}),
    ...(caveat ? { title: caveat } : {}),
  };
}

/** 生命周期灰化信息行：仅 merged（上游已删由「重新发布」主动作承担）。 */
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
  { id: "fetch" },
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
    tasks: [
      ...(status.repoState.kind === "clean" &&
      status.changeSummary.changedFiles === 0
        ? [{ id: "viewChanges" as const }]
        : []),
      ...FIXED_TASKS.map((task) => ({ ...task })),
    ],
    variant: "normal",
    gitRoot: options.gitRoot,
  };
}
