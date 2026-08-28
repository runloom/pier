import { AGENT_TERMINAL_EXIT_PRESENTATION } from "@shared/contracts/ghostty-host-copy.ts";
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
import type { ActiveTerminalLaunch } from "../panel-params.ts";

export function useRestartRestoredAgent(args: {
  activeLaunch: ActiveTerminalLaunch;
  panelId: string;
  restoredAgentResult: TerminalAgentPanelMetadata | undefined;
  savedSession: TerminalPanelSessionSnapshot | null | undefined;
}): {
  restart: () => Promise<void>;
  startNew: () => Promise<void>;
} {
  const { activeLaunch, panelId, restoredAgentResult, savedSession } = args;

  const run = useCallback(
    async (fresh: boolean) => {
      if (!restoredAgentResult) {
        return;
      }
      try {
        const resumeSessionId = fresh
          ? undefined
          : restoredAgentResult.resume?.sessionId.trim();
        const { launchId } = await window.pier.agents.prepareLaunchFromSpec({
          agentId: restoredAgentResult.agentId,
          ...(restoredAgentResult.launch.command
            ? { command: restoredAgentResult.launch.command }
            : {}),
          ...(restoredAgentResult.launch.cwd
            ? { cwd: restoredAgentResult.launch.cwd }
            : {}),
          ...(resumeSessionId ? { resumeSessionId } : {}),
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
          exitPresentation: AGENT_TERMINAL_EXIT_PRESENTATION,
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
    },
    [
      activeLaunch.context,
      activeLaunch.tab,
      panelId,
      restoredAgentResult,
      savedSession?.context,
      savedSession?.tab,
    ]
  );

  return {
    restart: () => run(false),
    startNew: () => run(true),
  };
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
