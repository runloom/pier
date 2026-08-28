import { join } from "node:path";
import { app } from "electron";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";
import {
  type TerminalSessionState,
  terminalSessionStateSchema,
} from "./terminal-session-state-schemas.ts";

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
      debounceMs: 500,
      defaults: DEFAULTS,
      filePath: resolveFilePath(),
    });
  }
  return store;
}

export async function ensureTerminalSessionStore(): Promise<
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

export function emptyWindowSession(): TerminalSessionState["windows"][string] {
  return { panels: {} };
}

/** 已 init 则返回 store；未创建或未 init 返回 null（不读盘）。 */
export function tryGetTerminalSessionStore(): DebouncedJsonStore<TerminalSessionState> | null {
  if (!store) {
    return null;
  }
  try {
    store.get();
    return store;
  } catch {
    return null;
  }
}

export function peekTerminalPanelContext(
  windowId: string,
  panelId: string
): TerminalSessionState["windows"][string]["panels"][string]["context"] | null {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return null;
  }
  const s = tryGetTerminalSessionStore();
  if (!s) {
    return null;
  }
  return s.get().windows[windowId]?.panels[panelId]?.context ?? null;
}

/** Running agent panel ids for a window record. Empty if the store is cold. */
export function listRunningAgentPanelIds(windowId: string): string[] {
  if (windowId.trim().length === 0) {
    return [];
  }
  const s = tryGetTerminalSessionStore();
  if (!s) {
    return [];
  }
  const panels = s.get().windows[windowId]?.panels ?? {};
  return Object.entries(panels)
    .filter(([, panel]) => panel.agent?.status === "running")
    .map(([panelId]) => panelId);
}

/** Sync peek of agent session metadata (running or exited). Null if store cold. */
export function peekTerminalPanelAgent(
  windowId: string,
  panelId: string
): TerminalSessionState["windows"][string]["panels"][string]["agent"] | null {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return null;
  }
  const s = tryGetTerminalSessionStore();
  if (!s) {
    return null;
  }
  return s.get().windows[windowId]?.panels[panelId]?.agent ?? null;
}
