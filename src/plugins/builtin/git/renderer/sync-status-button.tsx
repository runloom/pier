import { Button } from "@pier/ui/button.tsx";
import { STATUS_BAR_ITEM_TRIGGER_CLASS } from "@pier/ui/interactive-density.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitStatus } from "@shared/contracts/git.ts";
import {
  CloudDownload,
  Loader2,
  type LucideIcon,
  RefreshCw,
  Upload,
} from "lucide-react";
import type React from "react";
import { useSyncExternalStore } from "react";
import { confirmDialog } from "./command-helpers.ts";
import { pluginText } from "./plugin-text.ts";
import {
  chromeForAction,
  type RemoteSyncActionId,
  type RemoteSyncBlockReason,
  resolveRemoteSyncActionIdForChrome,
  resolveRemoteSyncBlockReason,
} from "./remote-sync-policy.ts";
import {
  gitStatusDropdownErrorMessage,
  runRemoteSyncAction,
} from "./status-dropdown-actions.ts";
import { SyncCounts } from "./status-parts.tsx";
import { isSyncBusy, subscribeSyncBusy } from "./sync-busy.ts";

const CONFIRM_SYNC_KEY = "pier.git.statusItem.confirmSync";

const ACTION_ICONS: Record<RemoteSyncActionId, LucideIcon> = {
  fetch: CloudDownload,
  publish: Upload,
  pull: RefreshCw,
  push: RefreshCw,
  syncChanges: RefreshCw,
};

export function gitSyncStatusHasContent(
  status: GitStatus,
  options: { busy?: boolean } = {}
): boolean {
  if (status.repoState.kind !== "clean") {
    return false;
  }
  // Model A: hide chrome when the only action would be a fresh "fetch".
  // Pass busy so in-flight fetch keeps chrome identity (not a bare busy shell).
  if (
    resolveRemoteSyncActionIdForChrome(
      status,
      Date.now(),
      options.busy === undefined ? {} : { busy: options.busy }
    ) !== null
  ) {
    return true;
  }
  return Boolean(options.busy);
}

function blockReasonText(
  pluginContext: RendererPluginContext,
  reason: RemoteSyncBlockReason
): string {
  switch (reason) {
    case "authRequired":
      return pluginText(
        pluginContext,
        "statusRowAuthBlocked",
        "Could not authenticate with the remote. Check credentials, then try again."
      );
    case "detached":
      return pluginText(
        pluginContext,
        "statusRowDetachedBlocked",
        "You are not on a branch. Switch to a branch first."
      );
    case "pullBlocked":
      return pluginText(
        pluginContext,
        "statusRowPullBlocked",
        "Commit or stash local changes before pulling"
      );
    default:
      return pluginText(
        pluginContext,
        "statusRowSyncUnavailable",
        "Remote sync is not available right now"
      );
  }
}

function syncDetail(
  pluginContext: RendererPluginContext,
  ahead: number,
  behind: number
): string {
  const parts: string[] = [];
  if (ahead > 0) {
    parts.push(`${ahead} ${pluginText(pluginContext, "srAhead", "ahead")}`);
  }
  if (behind > 0) {
    parts.push(`${behind} ${pluginText(pluginContext, "srBehind", "behind")}`);
  }
  return parts.join(", ");
}

async function confirmAndRunSync({
  actionId,
  pluginContext,
  upstream,
  gitRoot,
}: {
  actionId: RemoteSyncActionId;
  gitRoot: string;
  pluginContext: RendererPluginContext;
  upstream: null | string;
}): Promise<void> {
  if (
    actionId === "syncChanges" &&
    pluginContext.configuration.get<boolean>(CONFIRM_SYNC_KEY)
  ) {
    const confirmed = await confirmDialog(
      pluginContext,
      pluginText(pluginContext, "statusDropdownSync", "Sync Changes"),
      pluginText(
        pluginContext,
        "statusSyncConfirmBody",
        "This pulls from and pushes to {{upstream}}. You can turn off this confirmation in Git settings.",
        { upstream: upstream ?? "" }
      ),
      pluginText(pluginContext, "statusSyncConfirmButton", "Sync"),
      undefined,
      { intent: "default" }
    );
    if (!confirmed) {
      return;
    }
  }
  await runRemoteSyncAction(pluginContext, actionId, gitRoot);
}

/**
 * 状态栏远程项：chrome 由 REMOTE_SYNC_CHROME 表驱动。
 * gitRoot 为 busy / 执行 cwd 的唯一键。
 */
export function GitSyncStatusButton({
  gitRoot,
  pluginContext,
  status,
  syncCaveat,
}: {
  gitRoot: string;
  pluginContext: RendererPluginContext;
  status: GitStatus;
  syncCaveat: null | string;
}): React.ReactElement | null {
  const busy = useSyncExternalStore(subscribeSyncBusy, () =>
    isSyncBusy(gitRoot)
  );
  if (!gitSyncStatusHasContent(status, { busy })) {
    return null;
  }
  const { ahead, behind, upstream, upstreamGone } = status.branch;
  // Model A filter, but keep fetch chrome while busy / remoteSync is fetching.
  const actionId = resolveRemoteSyncActionIdForChrome(status, Date.now(), {
    busy,
  });

  const chrome = actionId ? chromeForAction(actionId, { upstreamGone }) : null;
  const countsDetail = syncDetail(pluginContext, ahead, behind);
  const detail = chrome?.detailKey
    ? pluginText(pluginContext, chrome.detailKey, chrome.detailFallback)
    : countsDetail;

  const blockReason =
    actionId === null && !busy ? resolveRemoteSyncBlockReason(status) : null;
  const blockedHint = blockReason
    ? blockReasonText(pluginContext, blockReason)
    : null;
  const actionHint = chrome
    ? pluginText(pluginContext, chrome.tooltipKey, chrome.tooltipFallback)
    : null;
  const busyHint =
    busy && chrome
      ? pluginText(pluginContext, chrome.busyKey, chrome.busyFallback)
      : null;

  const primaryLabel = chrome
    ? pluginText(pluginContext, chrome.labelKey, chrome.labelFallback)
    : pluginText(pluginContext, "statusSyncLabel", "Sync changes");

  const ariaLabel = [
    primaryLabel,
    detail,
    busyHint ?? actionHint ?? blockedHint,
    syncCaveat,
  ]
    .filter(Boolean)
    .join(", ");

  const onClick = (): void => {
    if (busy || actionId === null) {
      return;
    }
    confirmAndRunSync({
      actionId,
      gitRoot,
      pluginContext,
      upstream,
    }).catch((err: unknown) => {
      const message = gitStatusDropdownErrorMessage(err);
      const short =
        message.length < 160 &&
        !message.includes("\n") &&
        !message.includes("fatal:");
      if (short) {
        pluginContext.notifications.error(message);
        return;
      }
      pluginContext.dialogs
        .alert({
          body: message,
          title: pluginText(
            pluginContext,
            "statusDropdownRemoteFailed",
            "Remote operation failed"
          ),
        })
        .catch(() => undefined);
    });
  };

  const spinMode = chrome?.spin ?? false;
  const useLoader = Boolean(busy && spinMode === "loader");
  const spinIcon = Boolean(busy && spinMode === "semantic");
  let Icon: LucideIcon = RefreshCw;
  if (useLoader) {
    Icon = Loader2;
  } else if (actionId) {
    Icon = ACTION_ICONS[actionId];
  }
  const gitIcon = useLoader ? "git-busy" : (chrome?.gitIcon ?? "git-sync");

  const showLabel = actionId === "publish" || actionId === "fetch";
  const trailing = showLabel ? (
    <span className="truncate">{primaryLabel}</span>
  ) : (
    <SyncCounts
      ahead={ahead}
      behind={behind}
      pluginContext={pluginContext}
      syncCaveat={syncCaveat}
    />
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild openOnFocus={false}>
        <span className="inline-flex shrink-0">
          <Button
            aria-busy={busy || undefined}
            aria-label={ariaLabel}
            className={STATUS_BAR_ITEM_TRIGGER_CLASS}
            data-testid="git-sync-status-trigger"
            disabled={busy || actionId === null}
            onClick={onClick}
            size="status-bar"
            type="button"
            variant="ghost"
          >
            <Icon
              aria-hidden="true"
              className={cn((useLoader || spinIcon) && "animate-spin")}
              data-git-icon={gitIcon}
              data-icon
            />
            {trailing}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent
        align="end"
        className="max-w-sm flex-col items-start"
        side="top"
        sideOffset={6}
      >
        <div className="flex flex-col gap-0.5 font-mono">
          <span>{busyHint ?? actionHint ?? blockedHint}</span>
          {syncCaveat ? <span>{syncCaveat}</span> : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
