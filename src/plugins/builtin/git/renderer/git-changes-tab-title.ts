import {
  type GitReviewScope,
  type GitReviewTarget,
  gitReviewScopeSchema,
} from "@shared/contracts/git-review.ts";
import {
  type PanelTabChrome,
  panelContextSchema,
} from "@shared/contracts/panel.ts";

const PATH_SEPARATOR_RE = /[\\/]/;
const REFS_HEADS_PREFIX = "refs/heads/";
const REFS_REMOTES_PREFIX = "refs/remotes/";
const SHORT_OID_LENGTH = 7;
const TITLE_SEPARATOR = " · ";

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

  return {
    title,
    tooltip: {
      title: `${labels.typeLabel}${TITLE_SEPARATOR}${title}`,
      lines,
    },
  };
}
