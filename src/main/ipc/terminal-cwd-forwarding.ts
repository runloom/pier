import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { resolvePanelContextForPath } from "../services/panel-context-resolver.ts";
import { recordRecentPanelContext } from "../state/panel-context-state.ts";
import {
  peekTerminalPanelContext,
  updateTerminalPanelContext,
} from "../state/terminal-session-state.ts";
import type { AppWindow } from "../windows/app-window.ts";
import { forwardToWindow } from "./terminal-forwarding.ts";
import { windowRecordIdFor } from "./terminal-window-scope.ts";

/**
 * Last forwarded cwd keyed by window scope + panelId. Panel ids are not unique
 * across windows, so a bare panelId map would skip the wrong surface.
 */
const lastForwardedCwdByScope = new Map<string, string>();

function cwdForwardScopeKey(
  sessionScope: string | null,
  browserWindowId: number,
  panelId: string
): string {
  return `${sessionScope ?? `bw:${browserWindowId}`}::${panelId}`;
}

export function resetTerminalCwdForwardingForTests(): void {
  lastForwardedCwdByScope.clear();
}

/**
 * Shells (and Ghostty shell-integration) often re-emit OSC 7 on every prompt,
 * including empty Enter. Re-resolving git context + broadcasting would make the
 * terminal panel React tree re-render and look like a flash.
 */
export async function handleTerminalCwdChange(
  id: number,
  rawPanelId: string,
  cwd: string,
  targetWindow: AppWindow | null
): Promise<void> {
  const sessionScope =
    targetWindow && !targetWindow.isDestroyed()
      ? windowRecordIdFor(targetWindow)
      : null;
  const scopeKey = cwdForwardScopeKey(sessionScope, id, rawPanelId);
  const previousCwd =
    (sessionScope
      ? peekTerminalPanelContext(sessionScope, rawPanelId)?.cwd
      : undefined) ?? lastForwardedCwdByScope.get(scopeKey);
  if (previousCwd === cwd) {
    return;
  }

  const context = await resolvePanelContextForPath(cwd, {
    source: "panel",
  });
  // A concurrent same-cwd event may have won the race while we resolved.
  if (lastForwardedCwdByScope.get(scopeKey) === cwd) {
    return;
  }
  lastForwardedCwdByScope.set(scopeKey, cwd);
  await recordRecentPanelContext(context);
  if (targetWindow && !targetWindow.isDestroyed() && sessionScope) {
    await updateTerminalPanelContext(sessionScope, rawPanelId, context);
  }
  forwardToWindow(
    id,
    PIER_BROADCAST.TERMINAL_CWD_CHANGED,
    { panelId: rawPanelId, context },
    "pier-cwd-forward"
  );
}
