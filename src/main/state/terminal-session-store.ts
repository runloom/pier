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
