import { createLogger } from "@shared/logger.ts";
import { isWindowDetaching } from "../services/agents/window-detaching-guard.ts";
import { patchTerminalPanelAgentStatus } from "../state/terminal-session-state.ts";
import { findAppWindowByElectronId } from "../windows/identity.ts";
import { broadcastAgentEndStateForPanel } from "./terminal/end-state-broadcast.ts";
import { windowRecordIdFor } from "./terminal/window-scope.ts";

const log = createLogger("foreground-activity.ipc");

/** 智能体会话退出：落终态 + 定向广播 end-state（窗口未在转移时）。 */
export function markAgentSessionExited(args: {
  exitCode?: number | undefined;
  panelId: string;
  windowId: string;
}): void {
  const win = findAppWindowByElectronId(Number(args.windowId));
  if (!win || win.isDestroyed()) {
    return;
  }
  if (
    isWindowDetaching(args.windowId) ||
    isWindowDetaching(windowRecordIdFor(win))
  ) {
    return;
  }
  const sessionWindowId = windowRecordIdFor(win);
  patchTerminalPanelAgentStatus(sessionWindowId, args.panelId, {
    ...(args.exitCode === undefined ? {} : { exitCode: args.exitCode }),
    finishedAt: Date.now(),
    status: "exited",
  })
    .then((ok) => {
      if (ok) {
        broadcastAgentEndStateForPanel(win, sessionWindowId, args.panelId);
      }
    })
    .catch((err) => {
      log.error("agent session exit persist failed", { err });
    });
}
