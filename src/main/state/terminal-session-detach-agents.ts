import {
  type TerminalSessionState,
  terminalAgentPanelMetadataSchema,
} from "./terminal-session-state-schemas.ts";
import {
  ensureTerminalSessionStore,
  tryGetTerminalSessionStore,
} from "./terminal-session-store.ts";

function detachRunningAgentsInWindow(
  state: TerminalSessionState,
  recordId: string,
  now: number
): void {
  const windowState = state.windows[recordId];
  if (!windowState) {
    return;
  }
  for (const [panelId, panel] of Object.entries(windowState.panels)) {
    const agent = panel.agent;
    if (agent?.status !== "running") {
      continue;
    }
    const { exitCode: _exitCode, finishedAt: _finishedAt, ...kept } = agent;
    const parsed = terminalAgentPanelMetadataSchema.safeParse({
      ...kept,
      restore: { ...kept.restore, detachedAt: now },
    });
    if (!parsed.success) {
      continue;
    }
    windowState.panels[panelId] = {
      ...panel,
      agent: parsed.data,
      updatedAt: new Date(now).toISOString(),
    };
  }
}

/** Keep running agent sessions restorable across window close/quit. */
export async function detachAgentsForWindow(recordId: string): Promise<void> {
  if (recordId.trim().length === 0) {
    return;
  }
  const now = Date.now();
  const s = await ensureTerminalSessionStore();
  s.mutate((state) => {
    detachRunningAgentsInWindow(state, recordId, now);
    return state;
  });
}

/**
 * Quit path best-effort: only mutates when the store is already warm
 * (normal after flushOpenWindows). Does not init/read disk.
 */
export function detachAgentsForWindowSync(recordId: string): void {
  if (recordId.trim().length === 0) {
    return;
  }
  const s = tryGetTerminalSessionStore();
  if (!s) {
    return;
  }
  const now = Date.now();
  s.mutate((state) => {
    detachRunningAgentsInWindow(state, recordId, now);
    return state;
  });
}
