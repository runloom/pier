/**
 * Terminal session state persistence.
 *
 * Remembers the last cwd/title per window id + terminal panel id, so a
 * relaunched app can restore tab chrome before creating a fresh shell in the
 * same directory.
 *
 * Uses debouncedJsonStore: in-memory state + 500ms debounced atomic write.
 * No file lock — single-process, no cross-process contention.
 */
import { isAbsolute, join } from "node:path";
import { app } from "electron";
import { z } from "zod";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

const terminalPanelSessionSchema = z.object({
  cwd: z.string().optional(),
  title: z.string().optional(),
  updatedAt: z.string(),
});

const terminalRecentSessionSchema = z.object({
  closedAt: z.string(),
  cwd: z.string(),
  id: z.string(),
  panelId: z.string(),
  title: z.string().optional(),
});

const terminalWindowSessionSchema = z.object({
  panels: z.record(z.string(), terminalPanelSessionSchema),
  recentClosed: z.array(terminalRecentSessionSchema).default([]),
});

const terminalSessionStateSchema = z.object({
  version: z.literal(1),
  windows: z.record(z.string(), terminalWindowSessionSchema),
});

export type TerminalPanelSession = z.infer<typeof terminalPanelSessionSchema>;
export type TerminalRecentSession = z.infer<typeof terminalRecentSessionSchema>;
export type TerminalRecentSessionWithScope = TerminalRecentSession & {
  recordId: string;
};
type TerminalSessionState = z.infer<typeof terminalSessionStateSchema>;

const DEFAULTS: TerminalSessionState = {
  version: 1,
  windows: {},
};

const MAX_RECENT_CLOSED_SESSIONS = 20;

function resolveFilePath(): string {
  return join(app.getPath("userData"), "terminal-session-state.json");
}

let store: DebouncedJsonStore<TerminalSessionState> | undefined;

function getStore(): DebouncedJsonStore<TerminalSessionState> {
  if (!store) {
    store = debouncedJsonStore<TerminalSessionState>({
      filePath: resolveFilePath(),
      defaults: DEFAULTS,
      debounceMs: 500,
    });
  }
  return store;
}

/**
 * Ensure store is initialised (read from disk once) and validate the
 * parsed state. Falls back to defaults on corrupt or unknown-version data.
 */
async function ensureStore(): Promise<
  DebouncedJsonStore<TerminalSessionState>
> {
  const s = getStore();
  try {
    const raw = await s.init();
    // Validate on first init — corrupt files or future versions reset to defaults
    const parsed = terminalSessionStateSchema.parse(raw);
    if (needsNormalization(raw)) {
      s.replace(parsed);
    }
  } catch (err) {
    console.warn(
      "[terminal-session-state] parse failed, resetting to defaults:",
      err
    );
    await s.clear();
    await s.init();
  }
  return s;
}

function needsNormalization(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) {
    return true;
  }
  const windows = (raw as { windows?: unknown }).windows;
  if (typeof windows !== "object" || windows === null) {
    return true;
  }
  return Object.values(windows).some((windowState) => {
    if (typeof windowState !== "object" || windowState === null) {
      return true;
    }
    return !Array.isArray(
      (windowState as { recentClosed?: unknown }).recentClosed
    );
  });
}

function emptyWindowSession(): TerminalSessionState["windows"][string] {
  return { panels: {}, recentClosed: [] };
}

export async function readTerminalPanelSession(
  windowId: string,
  panelId: string
): Promise<TerminalPanelSession | null> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return null;
  }
  const s = await ensureStore();
  return s.get().windows[windowId]?.panels[panelId] ?? null;
}

function isRestorableCwd(cwd: string): boolean {
  return cwd.trim() === cwd && cwd.length > 0 && isAbsolute(cwd);
}

function isRestorableTitle(title: string): boolean {
  return title.trim().length > 0;
}

export async function updateTerminalPanelCwd(
  windowId: string,
  panelId: string,
  cwd: string
): Promise<void> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  if (!isRestorableCwd(cwd)) {
    return;
  }
  const s = await ensureStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId] ?? emptyWindowSession();
    state.windows[windowId] = windowState;
    const current = windowState.panels[panelId] ?? {};
    windowState.panels[panelId] = {
      ...current,
      cwd,
      updatedAt: new Date().toISOString(),
    };
    return state;
  });
}

export async function updateTerminalPanelTitle(
  windowId: string,
  panelId: string,
  title: string
): Promise<void> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  if (!isRestorableTitle(title)) {
    return;
  }
  const s = await ensureStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId] ?? emptyWindowSession();
    state.windows[windowId] = windowState;
    const current = windowState.panels[panelId] ?? {};
    windowState.panels[panelId] = {
      ...current,
      title,
      updatedAt: new Date().toISOString(),
    };
    return state;
  });
}

export async function archiveTerminalPanelSession(
  windowId: string,
  panelId: string
): Promise<void> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  const s = await ensureStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId];
    const current = windowState?.panels[panelId];
    if (!(windowState && current?.cwd)) {
      return state;
    }
    const closedAt = new Date().toISOString();
    const recent: TerminalRecentSession = {
      closedAt,
      cwd: current.cwd,
      id: `${panelId}:${closedAt}`,
      panelId,
      ...(current.title ? { title: current.title } : {}),
    };
    windowState.recentClosed = [
      recent,
      ...windowState.recentClosed.filter(
        (entry) => !(entry.panelId === panelId && entry.cwd === current.cwd)
      ),
    ].slice(0, MAX_RECENT_CLOSED_SESSIONS);
    return state;
  });
}

export async function listRecentTerminalPanelSessions(
  windowId: string
): Promise<TerminalRecentSession[]> {
  if (windowId.trim().length === 0) {
    return [];
  }
  const s = await ensureStore();
  return [...(s.get().windows[windowId]?.recentClosed ?? [])].sort((a, b) =>
    b.closedAt.localeCompare(a.closedAt)
  );
}

export async function listAllRecentTerminalPanelSessions(): Promise<
  TerminalRecentSessionWithScope[]
> {
  const s = await ensureStore();
  let sequence = 0;
  return Object.entries(s.get().windows)
    .flatMap(([recordId, windowState]) =>
      windowState.recentClosed.map((session) => ({
        ...session,
        recordId,
        __index: sequence++,
      }))
    )
    .sort((a, b) => {
      const byClosedAt = b.closedAt.localeCompare(a.closedAt);
      if (byClosedAt !== 0) {
        return byClosedAt;
      }
      return b.__index - a.__index;
    })
    .map(({ __index: _index, ...session }) => session);
}

export async function removeTerminalPanelSession(
  windowId: string,
  panelId: string
): Promise<void> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  const s = await ensureStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId];
    if (!windowState?.panels[panelId]) {
      return state;
    }
    delete windowState.panels[panelId];
    if (
      Object.keys(windowState.panels).length === 0 &&
      windowState.recentClosed.length === 0
    ) {
      delete state.windows[windowId];
    }
    return state;
  });
}

export async function flushTerminalSessionState(): Promise<void> {
  const s = await ensureStore();
  await s.flush();
}
