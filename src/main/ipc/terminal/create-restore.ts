import type { ResolvedTerminalLaunchOptions } from "@shared/contracts/terminal/launch.ts";
import type {
  TerminalAgentPanelMetadata,
  TerminalAgentRestoreOutcome,
} from "@shared/contracts/terminal.ts";
import {
  resolveAgentResumeLastLaunch,
  resolveAgentResumeLaunch,
} from "../../services/agents/resume-adapters.ts";

export function resolveRestoredAgentNativeLaunch(args: {
  contextCwd?: string | undefined;
  nativeLaunch: ResolvedTerminalLaunchOptions | undefined;
  restoredAgent?: TerminalAgentPanelMetadata | undefined;
}): {
  agentRestore: TerminalAgentRestoreOutcome | undefined;
  nativeLaunchBase: ResolvedTerminalLaunchOptions | undefined;
  restoreCwd: string | undefined;
} {
  const restoreCwd = args.contextCwd ?? args.restoredAgent?.launch.cwd;
  const resumeLaunch = args.restoredAgent
    ? resolveAgentResumeLaunch({
        agent: args.restoredAgent,
        cwd: restoreCwd ?? args.nativeLaunch?.cwd,
      })
    : null;
  let agentRestore: TerminalAgentRestoreOutcome | undefined;
  let nativeLaunchBase = resumeLaunch?.launch ?? args.nativeLaunch;
  if (resumeLaunch) {
    if (resumeLaunch.resumed) {
      agentRestore = "resumed";
    } else if (resumeLaunch.reason === "unsupported-agent") {
      agentRestore = "unsupported";
    } else {
      const restored = args.restoredAgent;
      const lastLaunch = restored
        ? resolveAgentResumeLastLaunch({
            agentId: restored.agentId,
            cwd: restoreCwd ?? restored.launch.cwd,
            launch: restored.launch,
          })
        : null;
      if (lastLaunch?.command) {
        nativeLaunchBase = lastLaunch;
        agentRestore = "resumed";
      } else {
        agentRestore = "cold-start";
      }
    }
  }
  return { agentRestore, nativeLaunchBase, restoreCwd };
}
