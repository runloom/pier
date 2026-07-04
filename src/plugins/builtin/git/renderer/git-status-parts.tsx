import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitBranchInfo,
  GitCounts,
  GitDelta,
  GitRepoState,
} from "@shared/contracts/git.ts";
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  Cherry,
  CloudOff,
  FilePlus,
  FolderGit2,
  GitBranch,
  GitCompareArrows,
  GitMerge,
  GitPullRequestArrow,
  type LucideIcon,
  Pencil,
  Undo2,
  Unlink,
} from "lucide-react";
import type React from "react";
import { pluginText } from "./git-plugin-text.ts";

function shortHead(head: string | undefined): string | undefined {
  return head ? head.slice(0, 7) : undefined;
}

export function SdDivider(): React.ReactElement {
  return <span aria-hidden="true" className="mx-1 h-3 w-px bg-border" />;
}

/** 图标 + 数字。sr-only 尾逗号让 WorkingTreeCounts 里多个 IconNum 连读有停顿。 */
function IconNum({
  icon: Icon,
  n,
  color,
  label,
}: {
  color: string;
  icon: LucideIcon;
  label: string;
  n: number;
}): React.ReactElement | null {
  if (n === 0) {
    return null;
  }
  return (
    <span className={`inline-flex items-center gap-0.5 tabular-nums ${color}`}>
      <Icon aria-hidden="true" className="h-3 w-3" />
      {n}
      <span className="sr-only"> {label},</span>
    </span>
  );
}

/**
 * 状态级（detached）与操作级（进行中）用扁平化文字胶囊（仅 text 色无底色边框）。
 * 信息级 / 需注意级走内联图标，见 UpstreamPill。
 */
const PILL_BASE =
  "inline-flex items-center gap-0.5 whitespace-nowrap px-1.5 py-0 text-[10px] leading-4";
const PILL_VARIANT = {
  progress: "text-status-info-fg",
  danger: "text-status-danger-fg",
  warning: "text-status-warning-fg",
  neutral: "text-foreground",
  success: "text-status-success-fg",
  done: "text-status-done-fg",
} as const;

function Pill({
  variant,
  icon: Icon,
  children,
  testId,
}: {
  children: React.ReactNode;
  icon?: LucideIcon;
  testId?: string;
  variant: keyof typeof PILL_VARIANT;
}): React.ReactElement {
  return (
    <span
      className={`${PILL_BASE} ${PILL_VARIANT[variant]}`}
      data-testid={testId}
    >
      {Icon && <Icon aria-hidden="true" className="h-3 w-3" />}
      {children}
    </span>
  );
}

export function WorktreeBadge({ name }: { name: string }): React.ReactElement {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <FolderGit2 aria-hidden="true" className="h-3 w-3 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function BranchLabel({
  branch,
  panelBranch,
  panelHead,
  worktreeFallback,
  pluginContext,
}: {
  branch: GitBranchInfo | null;
  /** Terminal panel context 里的分支名 —— status 还没到时的 fallback（避免闪 worktree 名）。 */
  panelBranch: null | string | undefined;
  panelHead: string | undefined;
  pluginContext: RendererPluginContext;
  worktreeFallback: string;
}): React.ReactElement {
  const effectiveBranch = branch?.branch ?? panelBranch ?? null;
  if (effectiveBranch) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1">
        <GitBranch aria-hidden="true" className="h-3 w-3 shrink-0" />
        <span className="truncate">{effectiveBranch}</span>
      </span>
    );
  }
  // detached HEAD：优先 status 里的 oid（porcelain v2 输出的 `# branch.oid`），
  // 其次 panel context 的 head（terminal 层跟踪）。避免仅有 worktree 名的裸退化。
  const head = shortHead(branch?.oid ?? panelHead ?? undefined);
  if (head) {
    return (
      <span className="inline-flex items-center gap-1">
        <Unlink aria-hidden="true" className="h-3 w-3" />
        <span className="tabular-nums">{head}</span>
        <Pill variant="neutral">
          {pluginText(pluginContext, "detachedShort", "DETACHED")}
        </Pill>
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <GitBranch aria-hidden="true" className="h-3 w-3 shrink-0" />
      <span className="truncate">{worktreeFallback}</span>
    </span>
  );
}

/**
 * Upstream 状态：no upstream 走 muted 内联图标 + tooltip（信息级）；
 * upstream gone 升级为 attention 级黄色文字胶囊（Primer attention 语义：
 * 远端分支删除通常是合并后的例行清理，非错误）——只有小图标时用户容易忽略"远端已删"。
 */
export function UpstreamPill({
  branch,
  pluginContext,
}: {
  branch: GitBranchInfo | null;
  pluginContext: RendererPluginContext;
}): React.ReactElement | null {
  if (!branch || branch.branch === null) {
    return null;
  }
  if (branch.upstreamGone) {
    return (
      <Pill icon={CloudOff} testId="upstream-gone-pill" variant="warning">
        {pluginText(pluginContext, "upstreamGone", "upstream gone")}
      </Pill>
    );
  }
  if (branch.upstream === null) {
    const label = pluginText(pluginContext, "noUpstream", "no upstream");
    return (
      <span
        className="inline-flex items-center text-muted-foreground"
        title={label}
      >
        <CloudOff aria-hidden="true" className="h-3 w-3" />
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return null;
}

/** 已合入默认分支。与 UpstreamPill(gone) 共存时即"可清理 worktree"的完整信号。 */
export function MergedPill({
  merged,
  pluginContext,
}: {
  merged: boolean | null;
  pluginContext: RendererPluginContext;
}): React.ReactElement | null {
  if (merged !== true) {
    return null;
  }
  return (
    <Pill icon={Check} testId="merged-pill" variant="done">
      {pluginText(pluginContext, "mergedIntoDefault", "merged")}
    </Pill>
  );
}

/** 5 种进行中操作共用同一渲染路径（progress 或有冲突时 danger），配置表驱动。 */
type ActiveState = Exclude<GitRepoState, { kind: "clean" }>;

const OP_CONFIG: Record<
  ActiveState["kind"],
  { icon: LucideIcon; labelFallback: string; labelKey: string }
> = {
  "cherry-picking": {
    icon: Cherry,
    labelFallback: "CHERRY-PICK",
    labelKey: "cherryPicking",
  },
  bisecting: {
    icon: GitCompareArrows,
    labelFallback: "BISECT",
    labelKey: "bisecting",
  },
  merging: { icon: GitMerge, labelFallback: "MERGING", labelKey: "merging" },
  rebasing: {
    icon: GitPullRequestArrow,
    labelFallback: "REBASING",
    labelKey: "rebasing",
  },
  reverting: { icon: Undo2, labelFallback: "REVERTING", labelKey: "reverting" },
};

function composeOperationText(
  state: ActiveState,
  pluginContext: RendererPluginContext
): string {
  const { labelKey, labelFallback } = OP_CONFIG[state.kind];
  const parts: string[] = [pluginText(pluginContext, labelKey, labelFallback)];
  if (state.kind === "rebasing" && state.total > 0) {
    parts.push(` ${state.current}/${state.total}`);
  }
  if (state.kind === "bisecting") {
    parts.push(
      pluginText(pluginContext, "bisectingSuffix", " · g{{good}}·b{{bad}}", {
        bad: state.bad,
        good: state.good,
      })
    );
  }
  if ("conflictCount" in state && state.conflictCount > 0) {
    parts.push(
      pluginText(pluginContext, "conflictSuffix", " · {{n}} conflicts", {
        n: state.conflictCount,
      })
    );
  }
  return parts.join("");
}

export function RepoStatePill({
  state,
  pluginContext,
}: {
  pluginContext: RendererPluginContext;
  state: GitRepoState;
}): React.ReactElement | null {
  if (state.kind === "clean") {
    return null;
  }
  const hasConflict = "conflictCount" in state && state.conflictCount > 0;
  const { icon } = OP_CONFIG[state.kind];
  return (
    <Pill icon={icon} variant={hasConflict ? "danger" : "progress"}>
      {composeOperationText(state, pluginContext)}
    </Pill>
  );
}

export function SyncCounts({
  ahead,
  behind,
  pluginContext,
}: {
  ahead: number;
  behind: number;
  pluginContext: RendererPluginContext;
}): React.ReactElement | null {
  if (ahead === 0 && behind === 0) {
    return null;
  }
  const aheadLabel = pluginText(pluginContext, "srAhead", "ahead");
  const behindLabel = pluginText(pluginContext, "srBehind", "behind");
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
      {ahead > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <ArrowUp aria-hidden="true" className="h-3 w-3" />
          {ahead}
          <span className="sr-only"> {aheadLabel},</span>
        </span>
      )}
      {behind > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <ArrowDown aria-hidden="true" className="h-3 w-3" />
          {behind}
          <span className="sr-only"> {behindLabel},</span>
        </span>
      )}
    </span>
  );
}

export function WorkingTreeCounts({
  counts,
  pluginContext,
}: {
  counts: GitCounts;
  pluginContext: RendererPluginContext;
}): React.ReactElement | null {
  const empty =
    counts.staged === 0 &&
    counts.modified === 0 &&
    counts.untracked === 0 &&
    counts.conflict === 0;
  if (empty) {
    return null;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <IconNum
        color="text-success"
        icon={Check}
        label={pluginText(pluginContext, "srStaged", "staged")}
        n={counts.staged}
      />
      <IconNum
        color="text-warning"
        icon={Pencil}
        label={pluginText(pluginContext, "srModified", "modified")}
        n={counts.modified}
      />
      <IconNum
        color="text-muted-foreground"
        icon={FilePlus}
        label={pluginText(pluginContext, "srUntracked", "untracked")}
        n={counts.untracked}
      />
      <IconNum
        color="text-status-danger-fg"
        icon={AlertTriangle}
        label={pluginText(pluginContext, "srConflict", "conflict")}
        n={counts.conflict}
      />
    </span>
  );
}

export function LineDelta({
  delta,
  pluginContext,
}: {
  delta: GitDelta | null;
  pluginContext: RendererPluginContext;
}): React.ReactElement | null {
  if (delta === null || (delta.insertions === 0 && delta.deletions === 0)) {
    return null;
  }
  const insertionsLabel = pluginText(
    pluginContext,
    "srInsertions",
    "insertions"
  );
  const deletionsLabel = pluginText(pluginContext, "srDeletions", "deletions");
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <span className="font-medium text-success">
        +{delta.insertions}
        <span className="sr-only"> {insertionsLabel},</span>
      </span>
      <span className="font-medium text-destructive">
        {/* U+2212 数学减号: 与 + 同轴同宽, hyphen-minus 会低半格造成视觉错位 */}
        {"\u2212"}
        {delta.deletions}
        <span className="sr-only"> {deletionsLabel},</span>
      </span>
    </span>
  );
}

/**
 * 大规模变更预警。触发阈值由调用方在 flags 派生阶段决定；本组件只负责渲染。
 * v7 稿 F 段 Pier 差异化：AI 一次改百文件是常态，提示避免用户忽略"这不是一次小改"。
 */
export function LargeChangeWarning({
  show,
  pluginContext,
}: {
  pluginContext: RendererPluginContext;
  show: boolean;
}): React.ReactElement | null {
  if (!show) {
    return null;
  }
  return (
    <Pill icon={AlertTriangle} variant="danger">
      {pluginText(pluginContext, "largeChange", "large change")}
    </Pill>
  );
}

export function StashBadge({
  count,
  pluginContext,
}: {
  count: number;
  pluginContext: RendererPluginContext;
}): React.ReactElement | null {
  if (count === 0) {
    return null;
  }
  const label = pluginText(pluginContext, "srStash", "stash");
  return (
    <span className="inline-flex items-center gap-0.5 text-muted-foreground tabular-nums">
      <Archive aria-hidden="true" className="h-3 w-3" />
      {count}
      <span className="sr-only"> {label},</span>
    </span>
  );
}
