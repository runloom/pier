import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitBranchInfo, GitRepoState } from "@shared/contracts/git.ts";
import {
  ArrowDown,
  ArrowUp,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  GitMerge,
  GitMergeConflict,
  GitPullRequestArrow,
  type LucideIcon,
} from "lucide-react";
import type React from "react";
import { pluginText } from "./plugin-text.ts";

function shortHead(head: string | undefined): string | undefined {
  return head ? head.slice(0, 7) : undefined;
}

export function WorktreeBadge({ name }: { name: string }): React.ReactElement {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <FolderGit2 aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** VS Code CheckoutStatusBar 同构：脏/冲突进图标，不写分项数字。 */
export type BranchIconKind = "clean" | "conflict" | "dirty" | "staged";

function BranchStatusIcon({
  kind,
}: {
  kind: BranchIconKind;
}): React.ReactElement {
  if (kind === "conflict") {
    return (
      <GitMergeConflict
        aria-hidden="true"
        className="size-3 shrink-0 text-status-danger-fg"
        data-git-icon="git-branch-conflicts"
      />
    );
  }
  if (kind === "staged") {
    return (
      <GitCommitHorizontal
        aria-hidden="true"
        className="size-3 shrink-0 text-success"
        data-git-icon="git-branch-staged"
      />
    );
  }
  if (kind === "dirty") {
    return (
      <GitBranch
        aria-hidden="true"
        className="size-3 shrink-0 text-warning"
        data-git-icon="git-branch-changes"
      />
    );
  }
  return (
    <GitBranch
      aria-hidden="true"
      className="size-3 shrink-0"
      data-git-icon="git-branch"
    />
  );
}

export function BranchLabel({
  branch,
  iconKind = "clean",
  operationLabel = null,
  operationTone = "info",
  panelBranch,
  panelHead,
  worktreeFallback,
  pluginContext,
}: {
  branch: GitBranchInfo | null;
  /** 脏/冲突态图标（对齐 VS Code git-branch-changes 等变体）。 */
  iconKind?: BranchIconKind;
  /** 进行中仓库操作短文案，如 Merging；叠在分支名旁，不加 Badge。 */
  operationLabel?: null | string;
  /** 有冲突用 danger，进行中操作用 info。 */
  operationTone?: "danger" | "info";
  /** Terminal panel context 里的分支名 —— status 还没到时的 fallback（避免闪 worktree 名）。 */
  panelBranch: null | string | undefined;
  panelHead: string | undefined;
  pluginContext: RendererPluginContext;
  worktreeFallback: string;
}): React.ReactElement {
  const dirtyTestId =
    iconKind === "dirty" || iconKind === "staged"
      ? "git-dirty-indicator"
      : undefined;
  const operation = operationLabel ? (
    <span
      className={cn(
        "shrink-0",
        operationTone === "danger"
          ? "text-status-danger-fg"
          : "text-status-info-fg"
      )}
    >
      ({operationLabel})
    </span>
  ) : null;
  const effectiveBranch = branch?.branch ?? panelBranch ?? null;
  if (effectiveBranch) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1">
        <span className="inline-flex shrink-0" data-testid={dirtyTestId}>
          <BranchStatusIcon kind={iconKind} />
        </span>
        <span className="truncate">{effectiveBranch}</span>
        {operation}
      </span>
    );
  }
  // detached HEAD：优先 status 里的 oid（porcelain v2 输出的 `# branch.oid`），
  // 其次 panel context 的 head（terminal 层跟踪）。避免仅有 worktree 名的裸退化。
  const head = shortHead(branch?.oid ?? panelHead ?? undefined);
  if (head) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex shrink-0" data-testid={dirtyTestId}>
          {iconKind === "clean" ? (
            <GitCommitHorizontal
              aria-hidden="true"
              className="size-3 shrink-0"
              data-git-icon="git-commit"
            />
          ) : (
            <BranchStatusIcon kind={iconKind} />
          )}
        </span>
        <span className="tabular-nums">{head}</span>
        <span className="shrink-0 text-muted-foreground">
          {pluginText(pluginContext, "detachedShort", "Detached")}
        </span>
        {operation}
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="inline-flex shrink-0" data-testid={dirtyTestId}>
        <BranchStatusIcon kind={iconKind} />
      </span>
      <span className="truncate">{worktreeFallback}</span>
      {operation}
    </span>
  );
}

/** 5 种进行中操作共用同一渲染路径，配置表驱动。 */
type ActiveState = Exclude<GitRepoState, { kind: "clean" }>;

const OP_CONFIG: Record<
  ActiveState["kind"],
  { icon: LucideIcon; iconId: string; labelFallback: string; labelKey: string }
> = {
  "cherry-picking": {
    icon: GitCommitHorizontal,
    iconId: "git-commit-horizontal",
    labelFallback: "Cherry-pick",
    labelKey: "cherryPicking",
  },
  bisecting: {
    icon: GitCompareArrows,
    iconId: "git-compare-arrows",
    labelFallback: "Bisect",
    labelKey: "bisecting",
  },
  merging: {
    icon: GitMerge,
    iconId: "git-merge",
    labelFallback: "Merging",
    labelKey: "merging",
  },
  rebasing: {
    icon: GitPullRequestArrow,
    iconId: "git-pull-request-arrow",
    labelFallback: "Rebasing",
    labelKey: "rebasing",
  },
  reverting: {
    icon: GitCommitHorizontal,
    iconId: "git-commit-horizontal",
    labelFallback: "Reverting",
    labelKey: "reverting",
  },
};

/** 底栏用：进行中仓库操作的短名（无进度/冲突计数；详情在下拉）。 */
export function formatRepoOperationLabel(
  state: GitRepoState,
  pluginContext: RendererPluginContext
): null | string {
  if (state.kind === "clean") {
    return null;
  }
  const { labelKey, labelFallback } = OP_CONFIG[state.kind];
  return pluginText(pluginContext, labelKey, labelFallback);
}

export function repoOperationHasConflicts(state: GitRepoState): boolean {
  return (
    state.kind !== "clean" &&
    "conflictCount" in state &&
    state.conflictCount > 0
  );
}

export function SyncCounts({
  ahead,
  behind,
  pluginContext,
  syncCaveat,
}: {
  ahead: number;
  behind: number;
  pluginContext: RendererPluginContext;
  /** Fetch freshness / auth caveat — annotate primary counts in-place. */
  syncCaveat?: string | null;
}): React.ReactElement | null {
  if (ahead === 0 && behind === 0) {
    return null;
  }
  const aheadLabel = pluginText(pluginContext, "srAhead", "ahead");
  const behindLabel = pluginText(pluginContext, "srBehind", "behind");
  const muted = Boolean(syncCaveat);
  return (
    <span
      className={
        muted
          ? "inline-flex items-center gap-1 text-muted-foreground/60 tabular-nums"
          : "inline-flex items-center gap-1 tabular-nums"
      }
    >
      {ahead > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <ArrowUp
            aria-hidden="true"
            className="size-3"
            data-git-icon="git-ahead"
          />
          {ahead}
          <span className="sr-only"> {aheadLabel},</span>
        </span>
      )}
      {behind > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <ArrowDown
            aria-hidden="true"
            className="size-3"
            data-git-icon="git-behind"
          />
          {behind}
          <span className="sr-only"> {behindLabel},</span>
        </span>
      )}
    </span>
  );
}
