import { AGENT_TERMINAL_EXIT_PRESENTATION } from "@shared/contracts/ghostty-host-copy.ts";
import type { PanelContext, PanelTabChrome } from "@shared/contracts/panel.ts";
import type {
  CreateTerminalResult,
  TerminalTryResumeLastSpec,
} from "@shared/contracts/terminal.ts";
import i18next from "i18next";
import { toast } from "sonner";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { requestTerminalRelaunch } from "@/stores/terminal-relaunch.store.ts";

/** Show cold-start / unsupported restore feedback; optional try-resume action. */
export function notifyAgentRestoreOutcome(args: {
  context: PanelContext | undefined;
  panelId: string;
  result: CreateTerminalResult;
  tab: PanelTabChrome | undefined;
  t: (key: string) => string;
}): void {
  const { context, panelId, result, tab, t } = args;
  if (result.agentRestore === "cold-start") {
    const tryLast = result.tryResumeLast;
    toast.message(t("terminal.agentSession.coldStart"), {
      ...(tryLast
        ? {
            action: {
              label: t("terminal.agentSession.tryResumeLast"),
              onClick: () => {
                requestTryResumeLast({
                  context,
                  panelId,
                  tab,
                  tryLast,
                }).catch((err) => {
                  console.error("[try-resume-last] unexpected failure:", err);
                });
              },
            },
          }
        : {}),
    });
    return;
  }
  if (result.agentRestore === "unsupported") {
    toast.message(t("terminal.agentSession.unsupported"));
  }
}

/**
 * User chose best-effort "latest in this folder" resume after cold-start.
 * Relaunch with agent-native last/continue (not a pinned prior panel session).
 * Never rejects: failures go to toast / showAppAlert.
 */
export async function requestTryResumeLast(args: {
  context: PanelContext | undefined;
  panelId: string;
  tab: PanelTabChrome | undefined;
  tryLast: TerminalTryResumeLastSpec;
}): Promise<void> {
  const { context, panelId, tab, tryLast } = args;
  try {
    const { launchId } = await window.pier.agents.prepareLaunchFromSpec({
      agentId: tryLast.agentId,
      command: tryLast.command,
      ...(tryLast.cwd ? { cwd: tryLast.cwd } : {}),
    });
    if (!launchId) {
      toast.error(i18next.t("terminal.agentSession.tryResumeLastFailed"));
      return;
    }
    let launchContext: PanelContext | undefined = context;
    if (context && tryLast.cwd) {
      launchContext = { ...context, cwd: tryLast.cwd };
    } else if (!context && tryLast.cwd) {
      launchContext = {
        contextId: `ctx-${panelId}`,
        cwd: tryLast.cwd,
        openedPath: tryLast.cwd,
        projectRootPath: tryLast.cwd,
        source: "command",
        updatedAt: Date.now(),
        worktreeKey: tryLast.cwd,
        worktreeRoot: tryLast.cwd,
      };
    }
    requestTerminalRelaunch({
      panelId,
      exitPresentation: AGENT_TERMINAL_EXIT_PRESENTATION,
      launchId,
      ...(launchContext ? { context: launchContext } : {}),
      ...(tab ? { tab } : {}),
    });
  } catch (error) {
    try {
      await showAppAlert({
        body: error instanceof Error ? error.message : String(error),
        title: i18next.t("terminal.agentSession.tryResumeLastFailed"),
      });
    } catch (alertError) {
      console.error("[try-resume-last] alert failed:", alertError);
    }
  }
}
