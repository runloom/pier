import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pier/ui/dropdown-menu.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  Check,
  CloudDownload,
  Diff,
  Download,
  FolderGit,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  GitMerge,
  GitPullRequestArrow,
  type LucideIcon,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import type React from "react";
import { useId, useState } from "react";
import { pluginText } from "./plugin-text.ts";
import {
  gitStatusDropdownErrorMessage,
  runGitStatusDropdownAction,
} from "./status-dropdown-actions.ts";
import type {
  GitStatusDropdownAction,
  GitStatusDropdownActionId,
  GitStatusDropdownLineDelta,
  GitStatusDropdownModel,
  GitStatusDropdownRow,
  GitStatusDropdownRowIcon,
  GitStatusDropdownRowTone,
} from "./status-dropdown-model.ts";

/** 与 change-summary / panel-tab trailing 一致：减号用 Unicode minus。 */
const LINE_DELETION_SIGN = "\u2212";

const TASK_ICONS: Record<GitStatusDropdownActionId, LucideIcon> = {
  abortOperation: X,
  continueOperation: Check,
  fetch: CloudDownload,
  publish: Upload,
  pull: Download,
  push: Upload,
  switchBranch: GitBranch,
  switchWorktree: FolderGit,
  syncChanges: RefreshCw,
  viewChanges: Diff,
};

const TASK_LABELS: Record<
  GitStatusDropdownActionId,
  { fallback: string; key: string }
> = {
  abortOperation: {
    fallback: "Abort",
    key: "statusRowAbortOperation",
  },
  continueOperation: {
    fallback: "Continue",
    key: "statusRowContinueOperation",
  },
  fetch: {
    fallback: "Fetch",
    key: "statusDropdownFetch",
  },
  publish: {
    fallback: "Publish Branch",
    key: "statusDropdownPublish",
  },
  pull: {
    fallback: "Pull Changes",
    key: "statusDropdownPull",
  },
  push: {
    fallback: "Push Changes",
    key: "statusDropdownPush",
  },
  switchBranch: {
    fallback: "Switch Branch",
    key: "statusDropdownSwitchBranch",
  },
  switchWorktree: {
    fallback: "Switch Worktree",
    key: "statusDropdownSwitchWorktree",
  },
  syncChanges: {
    fallback: "Sync Changes",
    key: "statusDropdownSync",
  },
  viewChanges: {
    fallback: "View Changes",
    key: "statusDropdownViewChanges",
  },
};

const ROW_ICONS: Record<
  GitStatusDropdownRowIcon,
  { Icon: LucideIcon; gitIcon: string }
> = {
  abort: { Icon: X, gitIcon: "git-abort" },
  bisect: { Icon: GitCompareArrows, gitIcon: "git-compare-arrows" },
  changed: { Icon: Diff, gitIcon: "git-diff" },
  cherryPick: {
    Icon: GitCommitHorizontal,
    gitIcon: "git-commit-horizontal",
  },
  clean: { Icon: GitCommitHorizontal, gitIcon: "git-commit-horizontal" },
  continue: { Icon: Check, gitIcon: "git-continue" },
  fetch: { Icon: CloudDownload, gitIcon: "git-fetch" },
  merge: { Icon: GitMerge, gitIcon: "git-merge" },
  merged: { Icon: GitMerge, gitIcon: "git-merge" },
  publish: { Icon: Upload, gitIcon: "git-publish" },
  pull: { Icon: Download, gitIcon: "git-pull" },
  push: { Icon: Upload, gitIcon: "git-push" },
  rebase: { Icon: GitPullRequestArrow, gitIcon: "git-pull-request-arrow" },
  revert: { Icon: GitCommitHorizontal, gitIcon: "git-commit-horizontal" },
  stash: { Icon: GitCommitHorizontal, gitIcon: "git-stash" },
  sync: { Icon: RefreshCw, gitIcon: "git-sync" },
};

const ROW_TONE_CLASSES: Record<GitStatusDropdownRowTone, string> = {
  danger: "text-status-danger-fg",
  default: "text-foreground",
  muted: "text-muted-foreground",
  warning: "text-status-warning-fg",
};

function LineDeltaValue({
  fileCount,
  lineDelta,
}: {
  fileCount: string;
  lineDelta: GitStatusDropdownLineDelta;
}): React.ReactElement {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span>{fileCount}</span>
      <span aria-hidden="true">·</span>
      <span className="text-success" data-git-delta="insertions">
        +{lineDelta.insertions}
      </span>
      <span className="text-status-danger-fg" data-git-delta="deletions">
        {LINE_DELETION_SIGN}
        {lineDelta.deletions}
      </span>
    </span>
  );
}

function RowContent({
  row,
}: {
  row: GitStatusDropdownRow;
}): React.ReactElement {
  const iconSpec = row.icon ? ROW_ICONS[row.icon] : null;
  const Icon = iconSpec?.Icon ?? null;
  return (
    <>
      {Icon && (
        <Icon
          aria-hidden="true"
          data-git-icon={iconSpec?.gitIcon}
          data-testid={`git-status-row-icon-${row.icon}`}
        />
      )}
      <span className={cn("truncate", ROW_TONE_CLASSES[row.tone])}>
        {row.label}
      </span>
      {row.assistiveLabel && (
        <span className="sr-only">{row.assistiveLabel}</span>
      )}
      {row.value && (
        <span
          aria-hidden={row.assistiveLabel ? true : undefined}
          className={cn(
            "ml-auto pl-3 text-xs tabular-nums",
            row.tone === "danger"
              ? "text-status-danger-fg"
              : "text-muted-foreground"
          )}
        >
          {row.lineDelta ? (
            <LineDeltaValue fileCount={row.value} lineDelta={row.lineDelta} />
          ) : (
            row.value
          )}
        </span>
      )}
    </>
  );
}

function StatusRow({
  onRun,
  row,
}: {
  onRun: (actionId: GitStatusDropdownActionId) => void;
  row: GitStatusDropdownRow;
}): React.ReactElement {
  if (row.action === null) {
    return (
      <DropdownMenuItem
        data-testid={`git-status-row-${row.id}`}
        disabled
        title={row.title}
      >
        <RowContent row={row} />
      </DropdownMenuItem>
    );
  }
  const actionId = row.action;
  return (
    <DropdownMenuItem
      data-testid={`git-status-row-${row.id}`}
      onSelect={() => onRun(actionId)}
      title={row.title}
      variant={row.tone === "danger" ? "destructive" : "default"}
    >
      <RowContent row={row} />
    </DropdownMenuItem>
  );
}

function TaskItem({
  action,
  onRun,
  pluginContext,
}: {
  action: GitStatusDropdownAction;
  onRun: (actionId: GitStatusDropdownActionId) => void;
  pluginContext: RendererPluginContext;
}): React.ReactElement {
  const Icon = TASK_ICONS[action.id];
  const label = TASK_LABELS[action.id];
  return (
    <DropdownMenuItem onSelect={() => onRun(action.id)}>
      <Icon />
      {pluginText(pluginContext, label.key, label.fallback)}
    </DropdownMenuItem>
  );
}

export function GitStatusDropdown({
  children,
  model,
  onViewChanges,
  pluginContext,
}: {
  children: React.ReactElement;
  model: GitStatusDropdownModel;
  onViewChanges: () => void;
  pluginContext: RendererPluginContext;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const menuTitleId = useId();
  const statusLabel = pluginText(pluginContext, "gitStatusLabel", "Git status");
  const onRun = (actionId: GitStatusDropdownActionId): void => {
    setOpen(false);
    if (actionId === "viewChanges") {
      onViewChanges();
      return;
    }
    runGitStatusDropdownAction({
      actionId,
      model,
      pluginContext,
    }).catch((err: unknown) => {
      pluginContext.notifications.error(gitStatusDropdownErrorMessage(err));
    });
  };

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-labelledby={menuTitleId}
        className="w-72"
        side="top"
      >
        <span className="sr-only" id={menuTitleId}>
          {statusLabel}
        </span>
        <DropdownMenuLabel>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium text-foreground text-sm">
              {model.branchLabel}
            </span>
            <span className="truncate text-muted-foreground text-xs">
              {model.contextLine}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {model.rows.map((row) => (
            <StatusRow key={row.id} onRun={onRun} row={row} />
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {model.tasks.map((task) => (
            <TaskItem
              action={task}
              key={task.id}
              onRun={onRun}
              pluginContext={pluginContext}
            />
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
