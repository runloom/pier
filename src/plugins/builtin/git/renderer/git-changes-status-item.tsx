import type {
  RendererPluginContext,
  RendererTerminalStatusItemContext,
} from "@plugins/api/renderer.ts";
import type React from "react";
import {
  GitChangesStatusButton,
  gitChangesStatusHasContent,
} from "./git-changes-status-button.tsx";
import { openGitChangesPanel } from "./git-review-open.ts";
import {
  SHOW_CHANGES_STATUS_KEY,
  useBooleanSetting,
} from "./git-status-item-shared.ts";
import { useGitStatus } from "./git-status-state.ts";

export function GitChangesStatusItem({
  context,
  getGroupId,
  pluginContext,
}: RendererTerminalStatusItemContext & {
  pluginContext: RendererPluginContext;
}): React.ReactElement | null {
  const panelContext = context;
  const worktreePath = panelContext?.worktreeRoot ?? panelContext?.gitRoot;
  const statusState = useGitStatus(pluginContext, panelContext?.gitRoot);
  const showChangesStatus = useBooleanSetting(
    pluginContext,
    SHOW_CHANGES_STATUS_KEY
  );
  if (!(showChangesStatus && panelContext && worktreePath)) {
    return null;
  }
  if (statusState.kind !== "loaded") {
    return null;
  }
  if (!gitChangesStatusHasContent(statusState.status)) {
    return null;
  }
  return (
    <GitChangesStatusButton
      onOpenChanges={() => {
        openGitChangesPanel({
          getGroupId,
          panelContext,
          pluginContext,
        }).catch(() => undefined);
      }}
      pluginContext={pluginContext}
      status={statusState.status}
    />
  );
}
