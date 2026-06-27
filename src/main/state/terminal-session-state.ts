/**
 * Terminal session state persistence.
 *
 * Remembers the last panel context/title per window id + terminal panel id, so a
 * relaunched app can restore tab chrome before creating a fresh shell in the
 * same directory.
 *
 * Uses debouncedJsonStore: in-memory state + 500ms debounced atomic write.
 * No file lock — single-process, no cross-process contention.
 */
import { join } from "node:path";
import {
  normalizePanelTabChromeInput,
  type PanelContext,
  type PanelTabChrome,
  panelContextSchema,
  panelTabChromeSchema,
} from "@shared/contracts/panel.ts";
import { app } from "electron";
import { z } from "zod";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

const terminalPanelSessionSchema = z.object({
  context: panelContextSchema.optional(),
  tab: z.preprocess(
    normalizePanelTabChromeInput,
    panelTabChromeSchema.optional()
  ),
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
    const parsed = terminalSessionStateSchema.parse(raw);
    if (JSON.stringify(raw) !== JSON.stringify(parsed)) {
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

function emptyWindowSession(): TerminalSessionState["windows"][string] {
  return { panels: {} };
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

function isRestorableTitle(title: string): boolean {
  return title.trim().length > 0;
}

function mergePanelTabChrome(
  current: PanelTabChrome | undefined,
  patch: Partial<PanelTabChrome>
): PanelTabChrome | undefined {
  const normalizedPatch = normalizePanelTabChromeInput(patch);
  if (!normalizedPatch) {
    return current;
  }
  const next = {
    ...(current ?? {}),
    ...normalizedPatch,
    ...(normalizedPatch.badge
      ? { badge: { ...(current?.badge ?? {}), ...normalizedPatch.badge } }
      : {}),
    ...(normalizedPatch.icon
      ? { icon: { ...(current?.icon ?? {}), ...normalizedPatch.icon } }
      : {}),
    ...(normalizedPatch.state
      ? { state: { ...(current?.state ?? {}), ...normalizedPatch.state } }
      : {}),
    ...(normalizedPatch.tooltip
      ? {
          tooltip: {
            ...(current?.tooltip ?? {}),
            ...normalizedPatch.tooltip,
          },
        }
      : {}),
  };
  return normalizePanelTabChromeInput(next) ?? current;
}

export async function updateTerminalPanelContext(
  windowId: string,
  panelId: string,
  context: PanelContext
): Promise<void> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  const s = await ensureStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId] ?? emptyWindowSession();
    state.windows[windowId] = windowState;
    const current = windowState.panels[panelId] ?? {};
    windowState.panels[panelId] = {
      ...current,
      context,
      updatedAt: new Date().toISOString(),
    };
    return state;
  });
}

export async function updateTerminalPanelTab(
  windowId: string,
  panelId: string,
  tab: PanelTabChrome
): Promise<void> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  const normalized = normalizePanelTabChromeInput(tab);
  if (!normalized) {
    return;
  }
  const s = await ensureStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId] ?? emptyWindowSession();
    state.windows[windowId] = windowState;
    const current = windowState.panels[panelId] ?? {};
    windowState.panels[panelId] = {
      ...current,
      tab: normalized,
      updatedAt: new Date().toISOString(),
    };
    return state;
  });
}

export async function patchTerminalPanelTab(
  windowId: string,
  panelId: string,
  tabPatch: Partial<PanelTabChrome>
): Promise<void> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  const s = await ensureStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId];
    const current = windowState?.panels[panelId];
    if (!(windowState && current)) {
      return state;
    }
    const tab = mergePanelTabChrome(current.tab, tabPatch);
    if (!tab) {
      return state;
    }
    windowState.panels[panelId] = {
      ...current,
      tab,
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
    const current = windowState.panels[panelId];
    if (!current) {
      return state;
    }
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

export async function flushTerminalSessionState(): Promise<void> {
  const s = await ensureStore();
  await s.flush();
}
