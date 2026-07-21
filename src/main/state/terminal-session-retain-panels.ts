import { ensureTerminalSessionStore } from "./terminal-session-store.ts";

export interface RetainTerminalPanelSessionsOptions {
  /** When true for a panel id, do not drop that session (transfer lease). */
  isLeased?: ((panelId: string) => boolean) | undefined;
}

/**
 * Drop panel sessions that are no longer in the live layout.
 * Call after layout restore / terminal reconcile with the active terminal panel ids.
 * Leased panels (mid-transfer) are retained even when absent from activePanelIds.
 */
export async function retainTerminalPanelSessions(
  recordId: string,
  activePanelIds: readonly string[],
  options?: RetainTerminalPanelSessionsOptions
): Promise<void> {
  if (recordId.trim().length === 0) {
    return;
  }
  const active = new Set(
    activePanelIds.filter(
      (id) => typeof id === "string" && id.trim().length > 0
    )
  );
  const isLeased = options?.isLeased;

  const s = await ensureTerminalSessionStore();
  s.mutate((state) => {
    const windowState = state.windows[recordId];
    if (!windowState) {
      return state;
    }
    for (const panelId of Object.keys(windowState.panels)) {
      if (active.has(panelId) || isLeased?.(panelId)) {
        continue;
      }
      delete windowState.panels[panelId];
    }
    if (Object.keys(windowState.panels).length === 0) {
      delete state.windows[recordId];
    }
    return state;
  });
}
