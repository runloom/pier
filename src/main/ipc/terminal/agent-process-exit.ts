import { createLogger } from "@shared/logger.ts";
import { isWindowDetaching } from "../../services/agents/window-detaching-guard.ts";
import { patchTerminalPanelAgentStatus } from "../../state/terminal-session-state.ts";
import type { AppWindow } from "../../windows/app-window.ts";
import { broadcastAgentEndStateForPanel } from "./end-state-broadcast.ts";
import { windowRecordIdFor } from "./window-scope.ts";

const log = createLogger("terminal.agent-process-exit");

/** Called only for native exit events after the current lifecycle gate. */
export function persistAgentProcessExit(
  win: AppWindow,
  panelId: string,
  exitCode?: number
): void {
  if (win.isDestroyed()) {
    return;
  }
  const sessionWindowId = windowRecordIdFor(win);
  if (isWindowDetaching(String(win.id)) || isWindowDetaching(sessionWindowId)) {
    return;
  }
  patchTerminalPanelAgentStatus(sessionWindowId, panelId, {
    ...(exitCode === undefined ? {} : { exitCode }),
    finishedAt: Date.now(),
    status: "exited",
  })
    .then((ok) => {
      if (ok) {
        broadcastAgentEndStateForPanel(win, sessionWindowId, panelId);
      }
    })
    .catch((err) => {
      log.error("agent process exit persist failed", { err, panelId });
    });
}
