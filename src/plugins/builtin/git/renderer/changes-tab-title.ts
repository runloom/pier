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
 * 类型语义由按 scope 区分的绿色图标承担（未提交 Diff / 提交 commit / 分支 branch），
 * 不把「变更」写进 tab。
 */
export function gitChangesPanelTitle(source: {
  readonly gitRootPath: string;
  readonly target: GitReviewTarget;
}): string {
  const folder = gitRootFolderName(source.gitRootPath);
  const suffix = gitReviewTargetTitleSuffix(source.target);
  return suffix ? `${folder}${TITLE_SEPARATOR}${suffix}` : folder;
}

/** Tab leading icon id（须在 `builtinPanelTabIcons` 注册）。 */
export type GitChangesPanelTabIconId =
  | "pier.git.changes.branch"
  | "pier.git.changes.commit"
  | "pier.git.changes.uncommitted";

export function gitChangesPanelTabIconId(
  target: GitReviewTarget
): GitChangesPanelTabIconId {
  if (target.kind === "commit") {
    return "pier.git.changes.commit";
  }
  if (target.kind === "branch") {
    return "pier.git.changes.branch";
  }
  return "pier.git.changes.uncommitted";
}

export interface GitChangesTabChromeLabels {
  readonly branchLabel: string;
  /** `ui.changeSummaryFilesVisible` 模板，含 `{{count}}`。 */
  readonly fileCountMany: string;
  /** `ui.changeSummaryFileVisible` 模板，含 `{{count}}`。 */
  readonly fileCountOne: string;
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
 * 审查 tab 用的 scope 级变更摘要。
 * - uncommitted：必须用工作树相对 HEAD 的净变化（与状态栏 `changeSummary` 同源，
 *   `git diff --numstat HEAD` + 未跟踪正文）。禁止把 staged + unstaged 组摘要相加：
 *   同路径两层 hunk 会把重叠改写计两次（差值为成对 +N −N）。
 * - commit / branch：审查 index 的 committed 组（范围 diff，不是工作树）。
 */
export function gitReviewTabChangeSummary(
  target: GitReviewTarget,
  input: {
    readonly groupSummaries?: GitReviewIndexOk["groupSummaries"];
    readonly workingTreeSummary?: GitChangeSummary;
  }
): GitChangeSummary | undefined {
  if (target.kind === "uncommitted") {
    return input.workingTreeSummary;
  }
  return input.groupSummaries?.committed;
}

function interpolateFileCountLabel(template: string, count: number): string {
  return template.replace(/\{\{\s*count\s*\}\}/g, String(count));
}

/**
 * Tab trailing 与状态栏 `GitChangeSummaryInline` 同规则：
 * 可见 +/- 用 `git-line-delta`；filesOnly / 全 0 行增量但有变更文件时用文件数文案；
 * `changedFiles === 0` 不展示（状态栏同样隐藏更改项）。
 */
export function gitTabTrailingFromSummary(
  summary: GitChangeSummary | undefined,
  labels: Pick<GitChangesTabChromeLabels, "fileCountMany" | "fileCountOne">
): PanelTabTrailing | undefined {
  if (!summary) {
    return;
  }
  if (
    summary.kind === "lineDelta" &&
    (summary.insertions > 0 || summary.deletions > 0)
  ) {
    return {
      deletions: summary.deletions,
      insertions: summary.insertions,
      kind: "git-line-delta",
    };
  }
  if (summary.changedFiles === 0) {
    return;
  }
  const label = interpolateFileCountLabel(
    summary.changedFiles === 1 ? labels.fileCountOne : labels.fileCountMany,
    summary.changedFiles
  );
  if (label.length === 0) {
    return;
  }
  return { kind: "text", label };
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

  const trailing = gitTabTrailingFromSummary(
    readTabChangeSummaryParam(params),
    labels
  );

  return {
    icon: { id: gitChangesPanelTabIconId(source.target) },
    title,
    tooltip: {
      title: `${labels.typeLabel}${TITLE_SEPARATOR}${title}`,
      lines,
    },
    ...(trailing ? { trailing } : {}),
  };
}
