import { join } from "node:path";
import {
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
  language: "zh-CN",
  uiFontFamily: "",
  monoFontFamily: "",
  monoFontSize: 13,
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
    projectPreferencesSchema.parse(raw);
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
