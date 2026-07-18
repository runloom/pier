import type { PanelContext } from "@shared/contracts/panel.ts";
import type {
  TerminalAgentPanelMetadata,
  TerminalPanelSessionSnapshot,
} from "@shared/contracts/terminal.ts";
import i18next from "i18next";
import { useCallback } from "react";
import { toast } from "sonner";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { requestTerminalRelaunch } from "@/stores/terminal-relaunch.store.ts";
import type { ActiveTerminalLaunch } from "./terminal-panel-params.ts";

export function useRestartRestoredAgent(args: {
  activeLaunch: ActiveTerminalLaunch;
  panelId: string;
  restoredAgentResult: TerminalAgentPanelMetadata | undefined;
  savedSession: TerminalPanelSessionSnapshot | null | undefined;
}): () => Promise<void> {
  const { activeLaunch, panelId, restoredAgentResult, savedSession } = args;

  return useCallback(async () => {
    if (!restoredAgentResult) {
      return;
    }
    try {
      const { launchId } = await window.pier.agents.prepareLaunchFromSpec({
        agentId: restoredAgentResult.agentId,
        ...(restoredAgentResult.launch.command
          ? { command: restoredAgentResult.launch.command }
          : {}),
        ...(restoredAgentResult.launch.cwd
          ? { cwd: restoredAgentResult.launch.cwd }
          : {}),
      });
      if (!launchId) {
        toast.error(i18next.t("terminal.agentSession.restartFailed"));
        return;
      }
      const context =
        savedSession?.context ??
        activeLaunch.context ??
        cwdFallbackContext(panelId, restoredAgentResult.launch.cwd);
      requestTerminalRelaunch({
        panelId,
        launchId,
        ...(context
          ? {
              context: restoredAgentResult.launch.cwd
                ? { ...context, cwd: restoredAgentResult.launch.cwd }
                : context,
            }
          : {}),
        ...(savedSession?.tab || activeLaunch.tab
          ? { tab: savedSession?.tab ?? activeLaunch.tab }
          : {}),
      });
    } catch (error) {
      await showAppAlert({
        body: error instanceof Error ? error.message : String(error),
        title: i18next.t("terminal.agentSession.restartFailed"),
      });
    }
  }, [
    activeLaunch.context,
    activeLaunch.tab,
    panelId,
    restoredAgentResult,
    savedSession?.context,
    savedSession?.tab,
  ]);
}

function cwdFallbackContext(
  panelId: string,
  cwd: string | undefined
): PanelContext | undefined {
  if (!cwd) {
    return;
  }
  return {
    contextId: `ctx-${panelId}`,
    cwd,
    openedPath: cwd,
    projectRootPath: cwd,
    source: "command",
    updatedAt: Date.now(),
    worktreeKey: cwd,
    worktreeRoot: cwd,
  };
}
