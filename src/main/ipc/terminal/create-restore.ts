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

/** Pin the resume id only for a real `--resume` spawn, not live PTY reuse. */
export function shouldLatchResumePending(args: {
  agentRestore: TerminalAgentRestoreOutcome | undefined;
  restoredAgent: TerminalAgentPanelMetadata | undefined;
}): boolean {
  if (args.agentRestore !== "resumed") {
    return false;
  }
  const sessionId = args.restoredAgent?.resume?.sessionId.trim();
  if (!sessionId) {
    return false;
  }
  const restore = args.restoredAgent?.restore;
  if (restore?.resumePending === true) {
    return true;
  }
  const liveSurfaceReuse =
    restore?.cause === undefined && (restore?.spawnGeneration ?? 0) >= 1;
  return !liveSurfaceReuse;
}
