import type {
  RendererPluginContext,
  RendererTerminalStatusItemContext,
} from "@plugins/api/renderer.ts";
import type React from "react";
import {
  GitChangesStatusButton,
  gitChangesStatusHasContent,
} from "./changes-status-button.tsx";
import { openGitChangesPanel } from "./review/open.ts";
import {
  gitIdentityRoot,
  SHOW_CHANGES_STATUS_KEY,
  useBooleanSetting,
} from "./status-item-shared.ts";
import { useGitStatus } from "./status-state.ts";

export function GitChangesStatusItem({
  context,
  getGroupId,
  pluginContext,
}: RendererTerminalStatusItemContext & {
  pluginContext: RendererPluginContext;
}): React.ReactElement | null {
  const panelContext = context;
  const gitRoot = gitIdentityRoot(panelContext);
  const statusState = useGitStatus(pluginContext, gitRoot);
  const showChangesStatus = useBooleanSetting(
    pluginContext,
    SHOW_CHANGES_STATUS_KEY
  );
  if (!(showChangesStatus && panelContext && gitRoot)) {
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
