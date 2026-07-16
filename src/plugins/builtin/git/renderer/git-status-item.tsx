import { Button } from "@pier/ui/button.tsx";
import type {
  RendererPluginContext,
  RendererTerminalStatusItemContext,
} from "@plugins/api/renderer.ts";
import type {
  GitCounts,
  GitDelta,
  GitRemoteSync,
  GitRepoState,
  GitStatus,
} from "@shared/contracts/git.ts";
import type React from "react";
import { useEffect, useState } from "react";
import { pluginText } from "./git-plugin-text.ts";
import { openGitChangesPanel } from "./git-review-open.ts";
import { GitStatusDropdown } from "./git-status-dropdown.tsx";
import {
  deriveGitStatusDropdownModel,
  type GitStatusDropdownModel,
} from "./git-status-dropdown-model.ts";
import { gitStatusDropdownText } from "./git-status-dropdown-text.ts";
import {
  BranchLabel,
  LargeChangeWarning,
  LineDelta,
  MergedPill,
  RepoStatePill,
  SdDivider,
  StashBadge,
  SyncCounts,
  UpstreamPill,
  WorkingTreeCounts,
  WorktreeBadge,
} from "./git-status-parts.tsx";
import { useGitStatus } from "./git-status-state.ts";

const PATH_SEPARATOR_RE = /[\\/]/;

function basename(path: null | string | undefined): string {
  if (!path) {
    return "";
  }
  const parts = path.split(PATH_SEPARATOR_RE).filter(Boolean);
  return parts.at(-1) ?? path;
}

/**
 * 远端同步健康度 tooltip 行。refs/remotes 是本地快照——诚实标注快照年龄/暂停原因，
 * 避免用户把 behind=0 当实时事实。backoff 沿用"x 分钟前"（上次成功仍然成立，自动重试中）。
 */
function remoteSyncLine(
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

/** 试点设置消费：经 context.configuration 读生效值并 onDidChange 实时响应。 */
function useShowDirtyIndicator(pluginContext: RendererPluginContext): boolean {
  const [value, setValue] = useState<boolean>(() =>
    pluginContext.configuration.get<boolean>(SHOW_DIRTY_INDICATOR_KEY)
  );
  useEffect(
    () =>
      pluginContext.configuration.onDidChange((event) => {
        if (event.affectsConfiguration(SHOW_DIRTY_INDICATOR_KEY)) {
          setValue(
            pluginContext.configuration.get<boolean>(SHOW_DIRTY_INDICATOR_KEY)
          );
        }
      }),
    [pluginContext]
  );
  return value;
}

/**
 * v1 硬编码；如需可调，走 preferences（Phase C）而不是环境变量或 remote config。
 */
const LARGE_CHANGE_FILE_THRESHOLD = 100;
const LARGE_CHANGE_LINE_THRESHOLD = 2000;
const SHOW_DIRTY_INDICATOR_KEY = "pier.git.statusItem.showDirtyIndicator";

interface StatusFlags {
  ahead: number;
  behind: number;
  counts: GitCounts;
  delta: GitDelta | null;
  hasDelta: boolean;
  hasLargeChange: boolean;
  hasRepoState: boolean;
  hasSync: boolean;
  hasWorkingChanges: boolean;
  isDistinctWorktree: boolean;
  repoState: GitRepoState;
  stashCount: number;
}

function deriveStatusFlags(
  status: GitStatus | null,
  context: RendererTerminalStatusItemContext["context"]
): StatusFlags {
  const counts = status?.counts ?? {
    conflict: 0,
    modified: 0,
    staged: 0,
    untracked: 0,
  };
  const repoState = status?.repoState ?? ({ kind: "clean" } as GitRepoState);
  const delta = status?.delta ?? null;
  const ahead = status?.branch?.ahead ?? 0;
  const behind = status?.branch?.behind ?? 0;
  const totalChanges =
    counts.staged + counts.modified + counts.untracked + counts.conflict;
  const totalLines = delta ? delta.insertions + delta.deletions : 0;
  return {
    ahead,
    behind,
    counts,
    delta,
    hasDelta: delta !== null && (delta.insertions > 0 || delta.deletions > 0),
    hasLargeChange:
      totalChanges > LARGE_CHANGE_FILE_THRESHOLD ||
      totalLines > LARGE_CHANGE_LINE_THRESHOLD,
    hasRepoState: repoState.kind !== "clean",
    hasSync: ahead > 0 || behind > 0,
    hasWorkingChanges: totalChanges > 0,
    isDistinctWorktree: Boolean(
      context?.worktreeRoot && context.worktreeRoot !== context.gitRoot
    ),
    repoState,
    stashCount: status?.stashCount ?? 0,
  };
}

function pendingDropdownModel({
  context,
  kind,
  pluginContext,
  worktreeName,
  worktreePath,
}: {
  context: NonNullable<RendererTerminalStatusItemContext["context"]>;
  kind: "error" | "loading";
  pluginContext: RendererPluginContext;
  worktreeName: string;
  worktreePath: string;
}): GitStatusDropdownModel {
  const branchLabel = context.branch ?? context.head ?? worktreeName;
  const statusLabel =
    kind === "loading"
      ? pluginText(
          pluginContext,
          "statusDropdownLoading",
          "Loading Git status…"
        )
      : pluginText(
          pluginContext,
          "statusDropdownUnavailable",
          "Git status unavailable"
        );
  return {
    actions: [{ id: "switchWorktree" }],
    branchLabel,
    contextLine: worktreeName,
    statusGroups: [
      {
        parts: [
          {
            label: statusLabel,
            tone: kind === "loading" ? "muted" : "danger",
          },
        ],
      },
    ],
    variant: kind === "loading" ? "loading" : "unavailable",
    worktreePath,
  };
}

function StatusBody({
  branch,
  context,
  flags,
  pluginContext,
  showDirtyIndicator,
  worktreeName,
}: {
  branch: GitStatus["branch"] | null;
  context: RendererTerminalStatusItemContext["context"];
  flags: StatusFlags;
  pluginContext: RendererPluginContext;
  showDirtyIndicator: boolean;
  worktreeName: string;
}): React.ReactElement {
  return (
    <>
      {flags.isDistinctWorktree && (
        <>
          <WorktreeBadge name={worktreeName} />
          <SdDivider />
        </>
      )}
      <BranchLabel
        branch={branch}
        panelBranch={context?.branch}
        panelHead={context?.head}
        pluginContext={pluginContext}
        worktreeFallback={worktreeName}
      />
      <UpstreamPill branch={branch} pluginContext={pluginContext} />
      <MergedPill
        merged={branch?.mergedIntoDefault ?? null}
        pluginContext={pluginContext}
      />
      {flags.hasRepoState && (
        <>
          <SdDivider />
          <RepoStatePill
            pluginContext={pluginContext}
            state={flags.repoState}
          />
        </>
      )}
      {flags.hasSync && (
        <>
          <SdDivider />
          <SyncCounts
            ahead={flags.ahead}
            behind={flags.behind}
            pluginContext={pluginContext}
          />
        </>
      )}
      {showDirtyIndicator && (flags.hasWorkingChanges || flags.hasDelta) && (
        <span className="contents" data-testid="git-dirty-indicator">
          <SdDivider />
          <WorkingTreeCounts
            counts={flags.counts}
            pluginContext={pluginContext}
          />
          <LineDelta delta={flags.delta} pluginContext={pluginContext} />
          <LargeChangeWarning
            pluginContext={pluginContext}
            show={flags.hasLargeChange}
          />
        </span>
      )}
      {flags.stashCount > 0 && (
        <>
          <SdDivider />
          <StashBadge count={flags.stashCount} pluginContext={pluginContext} />
        </>
      )}
    </>
  );
}

function WorktreeStatusItem({
  context,
  cwd,
  getGroupId,
  pluginContext,
}: RendererTerminalStatusItemContext & {
  pluginContext: RendererPluginContext;
}) {
  const panelContext = context;
  const worktreePath = panelContext?.worktreeRoot ?? panelContext?.gitRoot;
  const statusState = useGitStatus(pluginContext, panelContext?.gitRoot);
  const showDirtyIndicator = useShowDirtyIndicator(pluginContext);
  if (!(panelContext && worktreePath)) {
    return null;
  }
  const worktreeName = basename(worktreePath);
  if (!worktreeName) {
    return null;
  }

  const status = statusState.kind === "loaded" ? statusState.status : null;
  const branch = status?.branch ?? null;
  const flags = deriveStatusFlags(status, panelContext);
  const tooltipHint = pluginText(
    pluginContext,
    "statusDropdownOpenTooltip",
    "Click to open Git status"
  );
  const tooltipDetail = [worktreeName, branch?.branch, worktreePath, cwd]
    .filter(Boolean)
    .join(" · ");
  const syncLine = remoteSyncLine(pluginContext, status?.remoteSync ?? null);
  const dropdownModel =
    statusState.kind === "loaded"
      ? deriveGitStatusDropdownModel(statusState.status, panelContext, {
          fallbackWorktreeName: worktreeName,
          remoteSyncLabel: syncLine,
          text: gitStatusDropdownText(pluginContext),
          worktreePath,
        })
      : pendingDropdownModel({
          context: panelContext,
          kind: statusState.kind,
          pluginContext,
          worktreeName,
          worktreePath,
        });
  const trigger = (
    <Button
      aria-label={pluginText(
        pluginContext,
        "statusDropdownOpenLabel",
        "Open Git status for {{name}}",
        { name: branch?.branch ?? panelContext.branch ?? worktreeName }
      )}
      className="h-5 min-w-0 max-w-full gap-1 px-2 font-normal text-xs"
      data-testid="worktree-status-trigger"
      onClick={statusState.kind === "error" ? statusState.retry : undefined}
      size="xs"
      title={[tooltipHint, tooltipDetail, syncLine].filter(Boolean).join("\n")}
      type="button"
      variant="outline"
    >
      <StatusBody
        branch={branch}
        context={panelContext}
        flags={flags}
        pluginContext={pluginContext}
        showDirtyIndicator={showDirtyIndicator}
        worktreeName={worktreeName}
      />
    </Button>
  );

  return (
    <GitStatusDropdown
      model={dropdownModel}
      onViewChanges={() =>
        openGitChangesPanel({
          getGroupId,
          panelContext,
          pluginContext,
        })
      }
      pluginContext={pluginContext}
    >
      {trigger}
    </GitStatusDropdown>
  );
}

export function registerGitStatusItem(
  context: RendererPluginContext
): () => void {
  return context.terminalStatusItems.register({
    id: "pier.worktree.status",
    isVisible: ({ context: panelContext }) =>
      Boolean(
        panelContext?.worktreeRoot ??
          (panelContext?.worktreeSupported === false
            ? undefined
            : panelContext?.gitRoot)
      ),
    render: (statusContext) => (
      <WorktreeStatusItem {...statusContext} pluginContext={context} />
    ),
  });
}
