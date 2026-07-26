import { Button } from "@pier/ui/button.tsx";
import { STATUS_BAR_ITEM_TRIGGER_CLASS } from "@pier/ui/interactive-density.ts";
import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import type {
  RendererPluginContext,
  RendererTerminalStatusItemContext,
} from "@plugins/api/renderer.ts";
import type { GitStatus } from "@shared/contracts/git.ts";
import type React from "react";
import {
  GIT_CHANGES_STATUS_ITEM_ID,
  GIT_SYNC_STATUS_ITEM_ID,
  GIT_WORKTREE_STATUS_ITEM_ID,
} from "../manifest.ts";
import { GitChangesStatusItem } from "./git-changes-status-item.tsx";
import { pluginText } from "./git-plugin-text.ts";
import { openGitChangesPanel } from "./git-review-open.ts";
import { GitStatusDropdown } from "./git-status-dropdown.tsx";
import {
  deriveGitStatusDropdownModel,
  type GitStatusDropdownModel,
} from "./git-status-dropdown-model.ts";
import { gitStatusDropdownText } from "./git-status-dropdown-text.ts";
import {
  basename,
  deriveBranchIconKind,
  deriveStatusFlags,
  isGitStatusBarVisible,
  isStatusItemSettingEnabled,
  remoteSyncLine,
  SHOW_CHANGES_STATUS_KEY,
  SHOW_DIRTY_INDICATOR_KEY,
  SHOW_SYNC_STATUS_KEY,
  type StatusFlags,
  useBooleanSetting,
} from "./git-status-item-shared.ts";
import {
  type BranchIconKind,
  BranchLabel,
  formatRepoOperationLabel,
  repoOperationHasConflicts,
  WorktreeBadge,
} from "./git-status-parts.tsx";
import { useGitStatus } from "./git-status-state.ts";
import { GitSyncStatusItem } from "./git-sync-status-item.tsx";

function buildStatusAriaLabel({
  branchName,
  iconKind,
  operationLabel,
  pluginContext,
  statusKind,
}: {
  branchName: string;
  iconKind: BranchIconKind;
  operationLabel: null | string;
  pluginContext: RendererPluginContext;
  statusKind: "error" | "loaded" | "loading";
}): string {
  const parts = [
    pluginText(
      pluginContext,
      "statusDropdownOpenLabel",
      "Open Git status for {{name}}",
      { name: branchName }
    ),
  ];
  if (statusKind === "error") {
    parts.push(
      pluginText(
        pluginContext,
        "statusDropdownUnavailable",
        "Git status unavailable"
      )
    );
  } else if (statusKind === "loading") {
    parts.push(
      pluginText(pluginContext, "statusDropdownLoading", "Loading Git status…")
    );
  }
  if (operationLabel) {
    parts.push(operationLabel);
  }
  if (iconKind === "conflict") {
    parts.push(pluginText(pluginContext, "srConflict", "conflicts"));
  } else if (iconKind === "staged") {
    parts.push(pluginText(pluginContext, "srStaged", "staged"));
  } else if (iconKind === "dirty") {
    parts.push(pluginText(pluginContext, "srModified", "modified"));
  }
  return parts.join(", ");
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
    branchLabel,
    contextLine: worktreeName,
    operationKind: null,
    rows: [
      {
        action: null,
        id: "status",
        label: statusLabel,
        tone: kind === "loading" ? "muted" : "danger",
      },
    ],
    tasks: [{ id: "switchWorktree" }],
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
  const iconKind = deriveBranchIconKind(flags, showDirtyIndicator);
  const operationLabel = flags.hasRepoState
    ? formatRepoOperationLabel(flags.repoState, pluginContext)
    : null;
  const operationTone = repoOperationHasConflicts(flags.repoState)
    ? "danger"
    : "info";
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {flags.isDistinctWorktree ? <WorktreeBadge name={worktreeName} /> : null}
      <BranchLabel
        branch={branch}
        iconKind={iconKind}
        operationLabel={operationLabel}
        operationTone={operationTone}
        panelBranch={context?.branch}
        panelHead={context?.head}
        pluginContext={pluginContext}
        worktreeFallback={worktreeName}
      />
    </span>
  );
}

function GitBranchStatusItem({
  context,
  getGroupId,
  pluginContext,
}: RendererTerminalStatusItemContext & {
  pluginContext: RendererPluginContext;
}) {
  const panelContext = context;
  const worktreePath = panelContext?.worktreeRoot ?? panelContext?.gitRoot;
  const statusState = useGitStatus(pluginContext, panelContext?.gitRoot);
  const showDirtyIndicator = useBooleanSetting(
    pluginContext,
    SHOW_DIRTY_INDICATOR_KEY
  );
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
  const iconKind = deriveBranchIconKind(flags, showDirtyIndicator);
  const operationLabel = flags.hasRepoState
    ? formatRepoOperationLabel(flags.repoState, pluginContext)
    : null;
  const branchName = branch?.branch ?? panelContext.branch ?? worktreeName;
  const syncLine = remoteSyncLine(pluginContext, status?.remoteSync ?? null);
  const openChanges = (): void => {
    openGitChangesPanel({
      getGroupId,
      panelContext,
      pluginContext,
    }).catch(() => undefined);
  };
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

  return (
    <TooltipProvider>
      <GitStatusDropdown
        model={dropdownModel}
        onViewChanges={openChanges}
        pluginContext={pluginContext}
      >
        <Button
          aria-label={buildStatusAriaLabel({
            branchName,
            iconKind,
            operationLabel,
            pluginContext,
            statusKind: statusState.kind,
          })}
          className={cn(
            STATUS_BAR_ITEM_TRIGGER_CLASS,
            "max-w-64",
            statusState.kind === "error" && "text-status-danger-fg"
          )}
          data-testid="worktree-status-trigger"
          onClick={statusState.kind === "error" ? statusState.retry : undefined}
          size="status-bar"
          type="button"
          variant="ghost"
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
      </GitStatusDropdown>
    </TooltipProvider>
  );
}

export function registerGitStatusItem(
  context: RendererPluginContext
): () => void {
  const disposers = [
    context.terminalStatusItems.register({
      id: GIT_WORKTREE_STATUS_ITEM_ID,
      isVisible: ({ context: panelContext }) =>
        isGitStatusBarVisible(panelContext),
      render: (statusContext) => (
        <GitBranchStatusItem {...statusContext} pluginContext={context} />
      ),
    }),
    context.terminalStatusItems.register({
      id: GIT_CHANGES_STATUS_ITEM_ID,
      isVisible: ({ context: panelContext }) =>
        isGitStatusBarVisible(panelContext) &&
        isStatusItemSettingEnabled(context, SHOW_CHANGES_STATUS_KEY),
      render: (statusContext) => (
        <GitChangesStatusItem {...statusContext} pluginContext={context} />
      ),
    }),
    context.terminalStatusItems.register({
      id: GIT_SYNC_STATUS_ITEM_ID,
      isVisible: ({ context: panelContext }) =>
        isGitStatusBarVisible(panelContext) &&
        isStatusItemSettingEnabled(context, SHOW_SYNC_STATUS_KEY),
      render: (statusContext) => (
        <GitSyncStatusItem {...statusContext} pluginContext={context} />
      ),
    }),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
