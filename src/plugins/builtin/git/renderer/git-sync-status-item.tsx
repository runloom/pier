import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import type {
  RendererPluginContext,
  RendererTerminalStatusItemContext,
} from "@plugins/api/renderer.ts";
import type React from "react";
import {
  remoteSyncLine,
  SHOW_SYNC_STATUS_KEY,
  useBooleanSetting,
} from "./git-status-item-shared.ts";
import { useGitStatus } from "./git-status-state.ts";
import { isSyncBusy } from "./git-sync-busy.ts";
import {
  GitSyncStatusButton,
  gitSyncStatusHasContent,
} from "./git-sync-status-button.tsx";

export function GitSyncStatusItem({
  context,
  pluginContext,
}: RendererTerminalStatusItemContext & {
  pluginContext: RendererPluginContext;
}): React.ReactElement | null {
  const panelContext = context;
  const worktreePath = panelContext?.worktreeRoot ?? panelContext?.gitRoot;
  const statusState = useGitStatus(pluginContext, panelContext?.gitRoot);
  const showSyncStatus = useBooleanSetting(pluginContext, SHOW_SYNC_STATUS_KEY);
  if (!(showSyncStatus && panelContext && worktreePath)) {
    return null;
  }
  if (statusState.kind !== "loaded") {
    return null;
  }
  const busy = isSyncBusy(worktreePath);
  if (!gitSyncStatusHasContent(statusState.status, { busy })) {
    return null;
  }
  const syncLine = remoteSyncLine(
    pluginContext,
    statusState.status.remoteSync ?? null
  );
  const syncUncertain =
    statusState.status.remoteSync?.state === "authRequired" ||
    statusState.status.remoteSync?.lastSuccessAt === null;
  return (
    <TooltipProvider>
      <GitSyncStatusButton
        pluginContext={pluginContext}
        status={statusState.status}
        syncCaveat={syncUncertain ? syncLine : null}
        worktreePath={worktreePath}
      />
    </TooltipProvider>
  );
}
