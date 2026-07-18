import { ensureTerminalSessionStore } from "./terminal-session-store.ts";

/**
 * Drop panel sessions that are no longer in the live layout.
 * Call after layout restore / terminal reconcile with the active terminal panel ids.
 */
export async function retainTerminalPanelSessions(
  recordId: string,
  activePanelIds: readonly string[]
): Promise<void> {
  if (recordId.trim().length === 0) {
    return;
  }
  const active = new Set(
    activePanelIds.filter(
      (id) => typeof id === "string" && id.trim().length > 0
    )
  );
  const s = await ensureTerminalSessionStore();
  s.mutate((state) => {
    const windowState = state.windows[recordId];
    if (!windowState) {
      return state;
    }
    for (const panelId of Object.keys(windowState.panels)) {
      if (!active.has(panelId)) {
        delete windowState.panels[panelId];
      }
    }
    if (Object.keys(windowState.panels).length === 0) {
      delete state.windows[recordId];
    }
    return state;
  });
}
