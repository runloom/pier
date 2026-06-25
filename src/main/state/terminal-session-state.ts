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

const terminalWindowSessionSchema = z.object({
  panels: z.record(z.string(), terminalPanelSessionSchema),
});

const terminalSessionStateSchema = z.object({
  version: z.literal(1),
  windows: z.record(z.string(), terminalWindowSessionSchema),
});

export type TerminalPanelSession = z.infer<typeof terminalPanelSessionSchema>;
type TerminalSessionState = z.infer<typeof terminalSessionStateSchema>;

const DEFAULTS: TerminalSessionState = {
  version: 1,
  windows: {},
};

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
    terminalSessionStateSchema.parse(raw);
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
    const windowState = state.windows[windowId] ?? { panels: {} };
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
    const windowState = state.windows[windowId] ?? { panels: {} };
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
    if (Object.keys(windowState.panels).length === 0) {
      delete state.windows[windowId];
    }
    return state;
  });
}
