import {
  emptyWindowSession,
  ensureTerminalSessionStore,
} from "./terminal-session-store.ts";

/**
 * Invariant anchor: every live terminal panel owns a session entry under its
 * window record scope, even before any context/tab/task metadata arrives.
 * Transfer CAS and retain GC rely on entry presence.
 */
export async function ensureTerminalPanelSession(
  windowId: string,
  panelId: string
): Promise<void> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  const s = await ensureTerminalSessionStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId] ?? emptyWindowSession();
    state.windows[windowId] = windowState;
    if (!windowState.panels[panelId]) {
      windowState.panels[panelId] = {
        updatedAt: new Date().toISOString(),
      };
    }
    return state;
  });
}
