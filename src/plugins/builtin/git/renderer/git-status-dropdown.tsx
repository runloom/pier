import { Badge } from "@pier/ui/badge.tsx";
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
  Download,
  FolderGit,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  GitMerge,
  GitMergeConflict,
  GitPullRequestArrow,
  GitPullRequestClosed,
  type LucideIcon,
  RefreshCw,
  Upload,
} from "lucide-react";
import type React from "react";
import { useId, useState } from "react";
import { pluginText } from "./git-plugin-text.ts";
import {
  gitStatusDropdownErrorMessage,
  runGitStatusDropdownAction,
} from "./git-status-dropdown-actions.ts";
import type {
  GitStatusDropdownAction,
  GitStatusDropdownActionId,
  GitStatusDropdownModel,
  GitStatusDropdownSummaryGroup,
  GitStatusDropdownSummaryIcon,
  GitStatusDropdownSummaryPart,
  GitStatusDropdownSummaryTone,
} from "./git-status-dropdown-model.ts";

const ACTION_ICONS: Record<GitStatusDropdownActionId, LucideIcon> = {
  pull: Download,
  push: Upload,
  switchBranch: GitBranch,
  switchWorktree: FolderGit,
  syncChanges: RefreshCw,
};

const ACTION_LABELS: Record<
  GitStatusDropdownActionId,
  { fallback: string; key: string }
> = {
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
};

const STATUS_LABELS: Record<
  GitStatusDropdownModel["variant"],
  { fallback: string; key: string }
> = {
  active: { fallback: "in progress", key: "statusDropdownStateActive" },
  clean: { fallback: "clean", key: "statusDropdownStateClean" },
  completed: { fallback: "ready", key: "statusDropdownStateCompleted" },
  dirty: { fallback: "changed", key: "statusDropdownStateDirty" },
  loading: { fallback: "checking", key: "statusDropdownStateLoading" },
  unavailable: {
    fallback: "unavailable",
    key: "statusDropdownStateUnavailable",
  },
};

const STATUS_BADGE_VARIANTS = {
  active: "info",
  clean: "neutral",
  completed: "done",
  dirty: "warning",
  loading: "neutral",
  unavailable: "danger",
} as const satisfies Record<GitStatusDropdownModel["variant"], string>;

const SUMMARY_TONE_CLASSES: Record<GitStatusDropdownSummaryTone, string> = {
  danger: "text-status-danger-fg",
  default: "text-foreground",
  destructive: "text-destructive",
  done: "text-status-done-fg",
  info: "text-status-info-fg",
  muted: "text-muted-foreground",
  success: "text-success",
  warning: "text-status-warning-fg",
};

const SUMMARY_ICONS: Record<
  GitStatusDropdownSummaryIcon,
  { Icon: LucideIcon; gitIcon: string }
> = {
  ahead: { Icon: GitPullRequestArrow, gitIcon: "git-pull-request-arrow" },
  behind: { Icon: GitPullRequestArrow, gitIcon: "git-pull-request-arrow" },
  bisect: { Icon: GitCompareArrows, gitIcon: "git-compare-arrows" },
  changed: { Icon: GitCompareArrows, gitIcon: "git-compare-arrows" },
  cherryPick: {
    Icon: GitCommitHorizontal,
    gitIcon: "git-commit-horizontal",
  },
  clean: { Icon: GitCommitHorizontal, gitIcon: "git-commit-horizontal" },
  conflict: { Icon: GitMergeConflict, gitIcon: "git-merge-conflict" },
  merge: { Icon: GitMerge, gitIcon: "git-merge" },
  merged: { Icon: GitMerge, gitIcon: "git-merge" },
  rebase: { Icon: GitPullRequestArrow, gitIcon: "git-pull-request-arrow" },
  revert: { Icon: GitCommitHorizontal, gitIcon: "git-commit-horizontal" },
  upstreamGone: {
    Icon: GitPullRequestClosed,
    gitIcon: "git-pull-request-closed",
  },
};

function ActionItem({
  action,
  onRun,
  pluginContext,
}: {
  action: GitStatusDropdownAction;
  onRun: (actionId: GitStatusDropdownActionId) => void;
  pluginContext: RendererPluginContext;
}): React.ReactElement {
  const Icon = ACTION_ICONS[action.id];
  const label = ACTION_LABELS[action.id];
  return (
    <DropdownMenuItem onSelect={() => onRun(action.id)}>
      <Icon />
      {pluginText(pluginContext, label.key, label.fallback)}
    </DropdownMenuItem>
  );
}

function SummaryPart({
  part,
}: {
  part: GitStatusDropdownSummaryPart;
}): React.ReactElement {
  const iconSpec = part.icon ? SUMMARY_ICONS[part.icon] : null;
  const Icon = iconSpec?.Icon ?? null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 tabular-nums",
        SUMMARY_TONE_CLASSES[part.tone]
      )}
    >
      {Icon && (
        <Icon
          aria-hidden="true"
          className="size-3 shrink-0"
          data-git-icon={iconSpec?.gitIcon}
          data-testid={`git-status-summary-icon-${part.icon}`}
        />
      )}
      {part.label}
      {part.assistiveLabel && (
        <span className="sr-only"> {part.assistiveLabel},</span>
      )}
    </span>
  );
}

function SummaryLine({
  groups,
}: {
  groups: GitStatusDropdownSummaryGroup[];
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-medium text-sm leading-5">
      {groups.map((group, groupIndex) => (
        <span
          className="contents"
          key={group.parts
            .map((part) => `${part.label}-${part.tone}`)
            .join("|")}
        >
          {groupIndex > 0 && (
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            {group.parts.map((part) => (
              <SummaryPart key={`${part.label}-${part.tone}`} part={part} />
            ))}
          </span>
        </span>
      ))}
    </div>
  );
}

export function GitStatusDropdown({
  children,
  model,
  pluginContext,
}: {
  children: React.ReactElement;
  model: GitStatusDropdownModel;
  pluginContext: RendererPluginContext;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const menuTitleId = useId();
  const statusLabel = pluginText(pluginContext, "gitStatusLabel", "Git status");
  const variantLabel = STATUS_LABELS[model.variant];
  const onRun = (actionId: GitStatusDropdownActionId): void => {
    setOpen(false);
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
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium text-foreground text-sm">
                {model.branchLabel}
              </span>
              <span className="truncate text-muted-foreground text-xs">
                {model.contextLine}
              </span>
            </div>
            <Badge
              className="shrink-0"
              variant={STATUS_BADGE_VARIANTS[model.variant]}
            >
              {pluginText(
                pluginContext,
                variantLabel.key,
                variantLabel.fallback
              )}
            </Badge>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>
          <SummaryLine groups={model.statusGroups} />
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {model.actions.map((action) => (
            <ActionItem
              action={action}
              key={action.id}
              onRun={onRun}
              pluginContext={pluginContext}
            />
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
