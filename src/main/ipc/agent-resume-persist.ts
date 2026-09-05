import type { AgentKind } from "@shared/contracts/agent.ts";
import { createLogger } from "@shared/logger.ts";
import {
  peekTerminalPanelAgent,
  updateTerminalPanelAgentResume,
} from "../state/terminal-session-state.ts";
import { findAppWindowByElectronId } from "../windows/identity.ts";
import {
  windowRecordIdFor,
  windowRecordIdForElectronWindowId,
} from "./terminal/window-scope.ts";

const log = createLogger("agent-resume-persist");

/**
 * Persist hook session id as panel restore index.
 * Independent of FA turn-bookkeeping accept, but still rejects:
 * - missing sessionId / window
 * - panel already owned by a different agentId (foreign-agent equivalent)
 */
export function recordAgentResumeSession(args: {
  agentId: AgentKind;
  panelId: string;
  preserveExistingSession?: boolean | undefined;
  sessionId: string | undefined;
  unlockRotation?: boolean | undefined;
  windowId: string;
}): void {
  const sessionId = args.sessionId?.trim();
  if (!sessionId) {
    return;
  }
  const win = findAppWindowByElectronId(Number(args.windowId));
  const recordId =
    win && !win.isDestroyed()
      ? windowRecordIdFor(win)
      : windowRecordIdForElectronWindowId(args.windowId);
  if (!recordId) {
    log.warn("agent resume metadata skipped: window missing", {
      agentId: args.agentId,
      panelId: args.panelId,
      windowId: args.windowId,
    });
    return;
  }
  const panelAgent = peekTerminalPanelAgent(recordId, args.panelId);
  if (panelAgent && panelAgent.agentId !== args.agentId) {
    log.warn("agent resume metadata skipped: foreign agent", {
      agentId: args.agentId,
      ownerAgent: panelAgent.agentId,
      panelId: args.panelId,
      windowId: args.windowId,
    });
    return;
  }
  updateTerminalPanelAgentResume(
    recordId,
    args.panelId,
    {
      agentId: args.agentId,
      capturedAt: Date.now(),
      sessionId,
      source: "hook",
    },
    {
      ...(args.unlockRotation ? { unlockRotation: true } : {}),
      ...(args.preserveExistingSession
        ? { preserveExistingSession: true }
        : {}),
    }
  )
    .then((result) => {
      if (
        result === "applied" ||
        result === "pending" ||
        result === "unchanged" ||
        result === "pinned"
      ) {
        return;
      }
      log.warn("agent resume metadata not written", {
        agentId: args.agentId,
        panelId: args.panelId,
        result,
        sessionId,
        windowId: args.windowId,
      });
    })
    .catch((err) => {
      log.error("agent resume metadata persist failed", { err });
    });
}
