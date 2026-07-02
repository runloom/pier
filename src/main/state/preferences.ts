import { join } from "node:path";
import {
  DEFAULT_GIT_AUTO_FETCH_ENABLED,
  DEFAULT_GIT_AUTO_FETCH_INTERVAL_MINUTES,
  DEFAULT_TERMINAL_CURSOR_BLINK,
  DEFAULT_TERMINAL_CURSOR_STYLE,
  DEFAULT_TERMINAL_NEW_CWD_POLICY,
  DEFAULT_TERMINAL_PASTE_PROTECTION,
  DEFAULT_TERMINAL_SCROLLBACK_MB,
  DEFAULT_WINDOW_ZOOM_LEVEL,
  type ProjectPreferences,
  projectPreferencesSchema,
} from "@shared/contracts/preferences.ts";
import { app } from "electron";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

export type { ProjectPreferences } from "@shared/contracts/preferences.ts";

function resolveFilePath(): string {
  return join(app.getPath("userData"), "preferences.json");
}

const DEFAULTS: ProjectPreferences = {
  theme: "system",
  stylePresetId: "pierre",
  language: "system",
  uiFontFamily: "",
  monoFontFamily: "",
  monoFontSize: 13,
  terminalCursorStyle: DEFAULT_TERMINAL_CURSOR_STYLE,
  terminalCursorBlink: DEFAULT_TERMINAL_CURSOR_BLINK,
  terminalScrollbackMb: DEFAULT_TERMINAL_SCROLLBACK_MB,
  terminalPasteProtection: DEFAULT_TERMINAL_PASTE_PROTECTION,
  terminalNewCwdPolicy: DEFAULT_TERMINAL_NEW_CWD_POLICY,
  windowZoomLevel: DEFAULT_WINDOW_ZOOM_LEVEL,
  userKeymap: [],
  defaultAgentId: null,
  disabledAgentIds: [],
  agentDefaultArgs: {},
  agentDefaultEnv: {},
  agentCommandOverrides: {},
  worktreeBranchPrefix: "wt/",
  worktreeCopyPatterns: [".env*", "*.local", ".claude/settings.local.json"],
  worktreeSetupCommand: "",
  agentStatusHooks: true,
  gitAutoFetchEnabled: DEFAULT_GIT_AUTO_FETCH_ENABLED,
  gitAutoFetchIntervalMinutes: DEFAULT_GIT_AUTO_FETCH_INTERVAL_MINUTES,
};

let store: DebouncedJsonStore<ProjectPreferences> | undefined;

function getStore(): DebouncedJsonStore<ProjectPreferences> {
  if (!store) {
    store = debouncedJsonStore<ProjectPreferences>({
      filePath: resolveFilePath(),
      defaults: DEFAULTS,
      debounceMs: 500,
    });
  }
  return store;
}

async function ensureStore(): Promise<DebouncedJsonStore<ProjectPreferences>> {
  const s = getStore();
  try {
    const raw = await s.init();
    const parsed = projectPreferencesSchema.parse(raw);
    if (JSON.stringify(parsed) !== JSON.stringify(raw)) {
      s.replace(parsed);
    }
  } catch (err) {
    console.warn("[preferences] parse failed, resetting to defaults:", err);
    await s.clear();
    await s.init();
  }
  return s;
}

export async function readPreferences(): Promise<ProjectPreferences> {
  const s = await ensureStore();
  return s.get();
}

export async function updatePreferences(
  patch: Partial<ProjectPreferences>
): Promise<ProjectPreferences> {
  const s = await ensureStore();
  return s.mutate((current) => ({ ...current, ...patch }));
}
