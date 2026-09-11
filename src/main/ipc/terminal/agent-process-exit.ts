import { createLogger } from "@shared/logger.ts";
import { isWindowDetaching } from "../../services/agents/window-detaching-guard.ts";
import { patchTerminalPanelAgentStatus } from "../../state/terminal-session-state.ts";
import type { AppWindow } from "../../windows/app-window.ts";
import { broadcastAgentEndStateForPanel } from "./end-state-broadcast.ts";
import { toNativePanelKey } from "./panel-id.ts";
import { nativeTerminalProcesses } from "./process/registry.ts";
import { windowRecordIdFor } from "./window-scope.ts";

const log = createLogger("terminal.agent-process-exit");

/** Called only for native exit events after the current lifecycle gate. */
export function persistAgentProcessExit(
  win: AppWindow,
  panelId: string,
  exitCode?: number,
  lifecycleId?: string
): void {
  if (win.isDestroyed()) {
    return;
  }
  const sessionWindowId = windowRecordIdFor(win);
  if (isWindowDetaching(String(win.id)) || isWindowDetaching(sessionWindowId)) {
    return;
  }
  const process = nativeTerminalProcesses.get(toNativePanelKey(win, panelId));
  if (lifecycleId !== undefined && process?.lifecycleId !== lifecycleId) return;
  patchTerminalPanelAgentStatus(sessionWindowId, panelId, {
    ...(process
      ? {
          spawnGeneration: process.generation,
          endReason: process.stopping ? "stopped" : "exited",
        }
      : {}),
    ...(exitCode === undefined ? {} : { exitCode }),
    finishedAt: Date.now(),
    status: "exited",
  })
    .then((ok) => {
      const current = nativeTerminalProcesses.get(
        toNativePanelKey(win, panelId)
      );
      if (ok && (!lifecycleId || current?.lifecycleId === lifecycleId)) {
        broadcastAgentEndStateForPanel(win, sessionWindowId, panelId);
      }
    })
    .catch((err) => {
      log.error("agent process exit persist failed", { err, panelId });
    });
}
