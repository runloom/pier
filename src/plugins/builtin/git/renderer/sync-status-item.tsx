import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import type {
  RendererPluginContext,
  RendererTerminalStatusItemContext,
} from "@plugins/api/renderer.ts";
import type React from "react";
import {
  gitIdentityRoot,
  remoteSyncLine,
  SHOW_SYNC_STATUS_KEY,
  useBooleanSetting,
} from "./status-item-shared.ts";
import { useGitStatus } from "./status-state.ts";
import { isSyncBusy } from "./sync-busy.ts";
import {
  GitSyncStatusButton,
  gitSyncStatusHasContent,
} from "./sync-status-button.tsx";

export function GitSyncStatusItem({
  context,
  pluginContext,
}: RendererTerminalStatusItemContext & {
  pluginContext: RendererPluginContext;
}): React.ReactElement | null {
  const panelContext = context;
  // 远程动作 / busy 键统一用 git 身份路径（与 palette、remoteSync 登记一致）
  const gitRoot = gitIdentityRoot(panelContext);
  const statusState = useGitStatus(pluginContext, gitRoot);
  const showSyncStatus = useBooleanSetting(pluginContext, SHOW_SYNC_STATUS_KEY);
  if (!(showSyncStatus && panelContext && gitRoot)) {
    return null;
  }
  if (statusState.kind !== "loaded") {
    return null;
  }
  const busy = isSyncBusy(gitRoot);
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
        gitRoot={gitRoot}
        pluginContext={pluginContext}
        status={statusState.status}
        syncCaveat={syncUncertain ? syncLine : null}
      />
    </TooltipProvider>
  );
}
