import { join } from "node:path";
import {
  type PluginRegistryState,
  pluginRegistryStateSchema,
} from "@shared/contracts/plugin.ts";
import { app } from "electron";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

const DEFAULTS: PluginRegistryState = {
  plugins: {},
  version: 1,
};

function resolveFilePath(): string {
  return join(app.getPath("userData"), "plugin-state.json");
}

let store: DebouncedJsonStore<PluginRegistryState> | undefined;

function getStore(): DebouncedJsonStore<PluginRegistryState> {
  if (!store) {
    store = debouncedJsonStore<PluginRegistryState>({
      debounceMs: 500,
      defaults: DEFAULTS,
      filePath: resolveFilePath(),
    });
  }
  return store;
}

async function ensureStore(): Promise<DebouncedJsonStore<PluginRegistryState>> {
  const s = getStore();
  try {
    const raw = await s.init();
    const parsed = pluginRegistryStateSchema.parse(raw);
    if (JSON.stringify(raw) !== JSON.stringify(parsed)) {
      s.replace(parsed);
    }
  } catch (err) {
    console.warn("[plugin-state] parse failed, resetting to defaults:", err);
    await s.clear();
    await s.init();
  }
  return s;
}

export async function readPluginState(): Promise<PluginRegistryState> {
  const s = await ensureStore();
  return structuredClone(s.get());
}

export async function setPluginEnabledState(
  id: string,
  enabled: boolean,
  now = Date.now
): Promise<PluginRegistryState> {
  const s = await ensureStore();
  return structuredClone(
    s.mutate((state) => ({
      ...state,
      plugins: {
        ...state.plugins,
        [id]: { enabled, updatedAt: now() },
      },
    }))
  );
}

export async function flushPluginState(): Promise<void> {
  const s = await ensureStore();
  await s.flush();
}
