import { ensureTerminalSessionStore } from "./terminal-session-store.ts";

const RUNTIME_WINDOW_ID_REGEX = /^(main|w-\d+)$/;

function runtimeIdForRestoreIndex(index: number): string {
  return index === 0 ? "main" : `w-${index}`;
}

/**
 * One-time scope migration: legacy terminal-session-state entries were keyed
 * by runtime window id ("main"/"w-1"); the store is now keyed by window
 * record UUID. Map legacy keys onto the records the next restore would have
 * assigned those runtime ids to (preferred open order → allocator order),
 * which reproduces exactly what the legacy reader would have matched.
 *
 * Deterministic end state: after migration no runtime-shaped keys remain.
 * Unmappable runtime-shaped keys are dropped (their windows no longer
 * restore, so the data was unreachable). Record-keyed entries win merges.
 */
export async function migrateTerminalSessionScopesToRecordIds(
  orderedOpenRecordIds: readonly string[]
): Promise<void> {
  const s = await ensureTerminalSessionStore();
  const hasLegacyKeys = Object.keys(s.get().windows).some((key) =>
    RUNTIME_WINDOW_ID_REGEX.test(key)
  );
  if (!hasLegacyKeys) {
    return;
  }
  const mapping = new Map<string, string>();
  for (const [index, recordId] of orderedOpenRecordIds.entries()) {
    mapping.set(runtimeIdForRestoreIndex(index), recordId);
  }
  s.mutate((state) => {
    for (const [key, windowState] of Object.entries(state.windows)) {
      if (!RUNTIME_WINDOW_ID_REGEX.test(key)) {
        continue;
      }
      delete state.windows[key];
      const recordId = mapping.get(key);
      if (!recordId) {
        continue;
      }
      const existing = state.windows[recordId];
      if (!existing) {
        state.windows[recordId] = windowState;
        continue;
      }
      for (const [panelId, panel] of Object.entries(windowState.panels)) {
        if (!existing.panels[panelId]) {
          existing.panels[panelId] = panel;
        }
      }
    }
    return state;
  });
  await s.flush();
}
