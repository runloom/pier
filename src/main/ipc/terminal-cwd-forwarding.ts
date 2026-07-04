import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { resolvePanelContextForPath } from "../services/panel-context-resolver.ts";
import { recordRecentPanelContext } from "../state/panel-context-state.ts";
import { updateTerminalPanelContext } from "../state/terminal-session-state.ts";
import type { AppWindow } from "../windows/app-window.ts";
import { forwardToWindow } from "./terminal-forwarding.ts";
import { windowRecordIdFor } from "./terminal-window-scope.ts";

export async function handleTerminalCwdChange(
  id: number,
  rawPanelId: string,
  cwd: string,
  targetWindow: AppWindow | null
): Promise<void> {
  const context = await resolvePanelContextForPath(cwd, {
    source: "panel",
  });
  await recordRecentPanelContext(context);
  if (targetWindow && !targetWindow.isDestroyed()) {
    const sessionScope = windowRecordIdFor(targetWindow);
    await updateTerminalPanelContext(sessionScope, rawPanelId, context);
  }
  forwardToWindow(
    id,
    PIER_BROADCAST.TERMINAL_CWD_CHANGED,
    { panelId: rawPanelId, context },
    "pier-cwd-forward"
  );
}
