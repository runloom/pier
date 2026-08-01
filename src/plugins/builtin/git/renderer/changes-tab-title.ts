import {
  type GitReviewIndexOk,
  type GitReviewScope,
  type GitReviewTarget,
  gitReviewScopeSchema,
} from "@shared/contracts/git/review.ts";
import {
  type GitChangeSummary,
  gitChangeSummarySchema,
} from "@shared/contracts/git.ts";
import {
  type PanelTabChrome,
  type PanelTabTrailing,
  panelContextSchema,
} from "@shared/contracts/panel.ts";

const PATH_SEPARATOR_RE = /[\\/]/;
const REFS_HEADS_PREFIX = "refs/heads/";
const REFS_REMOTES_PREFIX = "refs/remotes/";
const SHORT_OID_LENGTH = 7;
const TITLE_SEPARATOR = " · ";

/** dockview params 键：审查 index 派生的 tab trailing 摘要（不进 title 字符串）。 */
export const GIT_CHANGES_TAB_CHANGE_SUMMARY_PARAM = "tabChangeSummary";

export function gitRootFolderName(gitRootPath: string): string {
  const parts = gitRootPath.split(PATH_SEPARATOR_RE).filter(Boolean);
  return parts.at(-1) ?? gitRootPath;
}

export function shortGitReviewRef(ref: string): string {
  if (ref.startsWith(REFS_HEADS_PREFIX)) {
    return ref.slice(REFS_HEADS_PREFIX.length);
  }
  if (ref.startsWith(REFS_REMOTES_PREFIX)) {
    return ref.slice(REFS_REMOTES_PREFIX.length);
  }
  return ref;
}

export function gitReviewTargetTitleSuffix(
  target: GitReviewTarget
): string | null {
  if (target.kind === "uncommitted") {
    return null;
  }
  if (target.kind === "commit") {
    return target.oid.slice(0, SHORT_OID_LENGTH);
  }
  return shortGitReviewRef(target.ref);
}

/**
 * Tab 短标题：工作树/仓库目录名；非未提交目标附加 ` ·` 后缀。
 * 类型语义由绿色 Diff 图标承担，不把「变更」写进 tab。
 */
export function gitChangesPanelTitle(source: {
  readonly gitRootPath: string;
  readonly target: GitReviewTarget;
}): string {
  const folder = gitRootFolderName(source.gitRootPath);
  const suffix = gitReviewTargetTitleSuffix(source.target);
  return suffix ? `${folder}${TITLE_SEPARATOR}${suffix}` : folder;
}

export interface GitChangesTabChromeLabels {
  readonly branchLabel: string;
  readonly pathLabel: string;
  readonly targetBranchLabel: string;
  readonly targetCommitLabel: string;
  readonly targetLabel: string;
  readonly targetUncommittedLabel: string;
  readonly typeLabel: string;
}

function targetTooltipValue(
  target: GitReviewTarget,
  labels: GitChangesTabChromeLabels
): string {
  if (target.kind === "commit") {
    return `${labels.targetCommitLabel}${TITLE_SEPARATOR}${target.oid.slice(0, SHORT_OID_LENGTH)}`;
  }
  if (target.kind === "branch") {
    return `${labels.targetBranchLabel}${TITLE_SEPARATOR}${shortGitReviewRef(target.ref)}`;
  }
  return labels.targetUncommittedLabel;
}

/**
 * 审查 tab 用的 scope 级变更摘要：
 * - uncommitted：合并 unstaged + staged 的 lineDelta（scope 总览，不随 surface 抖）
 * - commit / branch：committed 组
 * 无可用 lineDelta 或全 0 时返回 undefined（tab 不画 +/−）。
 */
export function gitReviewTabChangeSummary(
  target: GitReviewTarget,
  groupSummaries: GitReviewIndexOk["groupSummaries"]
): GitChangeSummary | undefined {
  if (target.kind === "uncommitted") {
    return mergeChangeSummaries(groupSummaries.unstaged, groupSummaries.staged);
  }
  return groupSummaries.committed;
}

export function gitLineDeltaTrailingFromSummary(
  summary: GitChangeSummary | undefined
): PanelTabTrailing | undefined {
  if (summary?.kind !== "lineDelta") {
    return;
  }
  if (summary.insertions === 0 && summary.deletions === 0) {
    return;
  }
  return {
    deletions: summary.deletions,
    insertions: summary.insertions,
    kind: "git-line-delta",
  };
}

function mergeChangeSummaries(
  left: GitChangeSummary | undefined,
  right: GitChangeSummary | undefined
): GitChangeSummary | undefined {
  if (!(left || right)) {
    return;
  }
  if (!(left && right)) {
    return left ?? right;
  }
  if (left.kind === "lineDelta" && right.kind === "lineDelta") {
    return {
      changedFiles: left.changedFiles + right.changedFiles,
      deletions: left.deletions + right.deletions,
      excludedFiles: left.excludedFiles + right.excludedFiles,
      insertions: left.insertions + right.insertions,
      kind: "lineDelta",
    };
  }
  // 任一侧行数不完整时，禁止拼出部分 +/−；优先保留 lineDelta 侧，否则 filesOnly。
  if (left.kind === "lineDelta") {
    return left;
  }
  if (right.kind === "lineDelta") {
    return right;
  }
  return {
    changedFiles: left.changedFiles + right.changedFiles,
    kind: "filesOnly",
    omittedFiles: left.omittedFiles + right.omittedFiles,
    reasons: [...new Set([...left.reasons, ...right.reasons])].slice(0, 8),
  };
}

function readTabChangeSummaryParam(
  params: Readonly<Record<string, unknown>>
): GitChangeSummary | undefined {
  if (!(GIT_CHANGES_TAB_CHANGE_SUMMARY_PARAM in params)) {
    return;
  }
  const raw = params[GIT_CHANGES_TAB_CHANGE_SUMMARY_PARAM];
  if (raw === null || raw === undefined) {
    return;
  }
  const parsed = gitChangeSummarySchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function gitChangesPanelTabChrome(
  params: Readonly<Record<string, unknown>>,
  labels: GitChangesTabChromeLabels
): PanelTabChrome | undefined {
  if (!("source" in params)) {
    return;
  }
  const parsed = gitReviewScopeSchema.safeParse(params.source);
  if (!parsed.success) {
    return;
  }
  const source: GitReviewScope = parsed.data;
  const title = gitChangesPanelTitle(source);
  const context =
    "context" in params
      ? panelContextSchema.safeParse(params.context)
      : undefined;
  const branch =
    context?.success && typeof context.data.branch === "string"
      ? context.data.branch
      : undefined;

  const lines: { label: string; value: string }[] = [
    { label: labels.pathLabel, value: source.gitRootPath },
  ];
  if (branch) {
    lines.push({ label: labels.branchLabel, value: branch });
  }
  lines.push({
    label: labels.targetLabel,
    value: targetTooltipValue(source.target, labels),
  });

  const trailing = gitLineDeltaTrailingFromSummary(
    readTabChangeSummaryParam(params)
  );

  return {
    title,
    tooltip: {
      title: `${labels.typeLabel}${TITLE_SEPARATOR}${title}`,
      lines,
    },
    ...(trailing ? { trailing } : {}),
  };
}
