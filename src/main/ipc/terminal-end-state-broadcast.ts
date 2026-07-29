import { materializeAgentEndState } from "@shared/contracts/terminal-end-state.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { createLogger } from "@shared/logger.ts";
import { peekTerminalPanelAgent } from "../state/terminal-session-store.ts";
import type { AppWindow } from "../windows/app-window.ts";

const log = createLogger("terminal-end-state");

/** main → renderer：agent 已 exited 时广播 TerminalEndState。 */
export function broadcastAgentEndStateForPanel(
  win: AppWindow,
  sessionWindowId: string,
  panelId: string
): void {
  const agent = peekTerminalPanelAgent(sessionWindowId, panelId);
  if (agent?.status !== "exited") {
    return;
  }
  if (win.isDestroyed()) {
    return;
  }
  const end = materializeAgentEndState({
    agentId: agent.agentId,
    ...(agent.exitCode === undefined ? {} : { exitCode: agent.exitCode }),
    ...(agent.finishedAt === undefined ? {} : { finishedAt: agent.finishedAt }),
    panelId,
  });
  try {
    win.webContents.send(PIER_BROADCAST.TERMINAL_END_STATE_CHANGED, end);
  } catch (err) {
    log.error("terminal end state broadcast failed", { err, panelId });
  }
}
