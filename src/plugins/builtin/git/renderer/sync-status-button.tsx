import { Button } from "@pier/ui/button.tsx";
import { STATUS_BAR_ITEM_TRIGGER_CLASS } from "@pier/ui/interactive-density.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitStatus } from "@shared/contracts/git.ts";
import { RefreshCw } from "lucide-react";
import type React from "react";
import { useSyncExternalStore } from "react";
import { confirmDialog } from "./command-helpers.ts";
import { pluginText } from "./plugin-text.ts";
import {
  type GitRemoteSyncActionId,
  gitStatusDropdownErrorMessage,
  runRemoteSyncAction,
} from "./status-dropdown-actions.ts";
import { resolveRemoteSyncActionId } from "./status-dropdown-model.ts";
import { SyncCounts } from "./status-parts.tsx";
import { isSyncBusy, subscribeSyncBusy } from "./sync-busy.ts";

/** VS Code confirmSync 同构：仅双向 sync 需确认，单向 push/pull 直接执行。 */
const CONFIRM_SYNC_KEY = "pier.git.statusItem.confirmSync";

/** 与底栏空壳判定共用：clean + 上游可用 +（↑↓ 非零或 busy）。 */
export function gitSyncStatusHasContent(
  status: GitStatus,
  options: { busy?: boolean } = {}
): boolean {
  if (status.repoState.kind !== "clean") {
    return false;
  }
  const { ahead, behind, upstream, upstreamGone } = status.branch;
  if (upstream === null || upstreamGone) {
    return false;
  }
  return ahead > 0 || behind > 0 || Boolean(options.busy);
}

const ACTION_TOOLTIPS: Record<
  GitRemoteSyncActionId,
  { fallback: string; key: string }
> = {
  pull: { fallback: "Pull Changes", key: "statusDropdownPull" },
  push: { fallback: "Push Changes", key: "statusDropdownPush" },
  syncChanges: { fallback: "Sync Changes", key: "statusDropdownSync" },
};

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
  worktreePath,
}: {
  actionId: GitRemoteSyncActionId;
  pluginContext: RendererPluginContext;
  upstream: null | string;
  worktreePath: string;
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
  await runRemoteSyncAction(pluginContext, actionId, worktreePath);
}

/**
 * 状态栏独立同步项（VS Code sync 状态栏项同构）：
 * - 仅在 repoState clean、上游可用且 ↑/↓ 非零（或同步进行中）时出现；
 * - 点击执行 push / pull / sync（双向 sync 首次经 confirmSync 设置确认）；
 * - busy 期间图标旋转、禁点，同一工作树多面板共享 busy 态并发去重；
 * - 不可执行时（behind + 本地有改动阻塞 pull）降级为可读信息态。
 */
export function GitSyncStatusButton({
  pluginContext,
  status,
  syncCaveat,
  worktreePath,
}: {
  pluginContext: RendererPluginContext;
  status: GitStatus;
  /** Fetch 快照年龄/暂停原因（↑↓ 数字可能过期时标注）。 */
  syncCaveat: null | string;
  worktreePath: string;
}): React.ReactElement | null {
  const busy = useSyncExternalStore(subscribeSyncBusy, () =>
    isSyncBusy(worktreePath)
  );
  if (!gitSyncStatusHasContent(status, { busy })) {
    return null;
  }
  const { ahead, behind, upstream } = status.branch;
  const actionId = resolveRemoteSyncActionId(status);
  const detail = syncDetail(pluginContext, ahead, behind);
  const blockedHint =
    actionId === null && !busy
      ? pluginText(
          pluginContext,
          "statusRowPullBlocked",
          "Commit or stash local changes before pulling"
        )
      : null;
  const actionHint = actionId
    ? pluginText(
        pluginContext,
        ACTION_TOOLTIPS[actionId].key,
        ACTION_TOOLTIPS[actionId].fallback
      )
    : null;
  const busyHint = busy
    ? pluginText(pluginContext, "statusDropdownSyncing", "Syncing changes…")
    : null;
  // openOnFocus=false：动作/阻塞/caveat 并入 aria，避免键盘用户只听见泛化「同步」。
  const ariaLabel = [
    pluginText(pluginContext, "statusSyncLabel", "Sync changes"),
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
      pluginContext,
      upstream,
      worktreePath,
    }).catch((err: unknown) => {
      pluginContext.notifications.error(gitStatusDropdownErrorMessage(err));
    });
  };
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
            <RefreshCw
              aria-hidden="true"
              className={cn(busy && "animate-spin")}
              data-git-icon="git-sync"
              data-icon
            />
            <SyncCounts
              ahead={ahead}
              behind={behind}
              pluginContext={pluginContext}
              syncCaveat={syncCaveat}
            />
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
