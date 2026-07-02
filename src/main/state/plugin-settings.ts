import { join } from "node:path";
import {
  type JsonValue,
  type PluginSettingsState,
  pluginSettingsStateSchema,
} from "@shared/contracts/plugin-settings.ts";
import { app } from "electron";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

const DEFAULTS: PluginSettingsState = {
  values: {},
  version: 1,
};

export interface PluginSettingsStore {
  flush(): Promise<void>;
  /** 同步读内存态 — 必须先 await init()（host-api refresh 入口保证）。 */
  getValues(): Record<string, JsonValue>;
  init(): Promise<PluginSettingsState>;
  read(): Promise<PluginSettingsState>;
  resetValue(key: string): PluginSettingsState;
  setValue(key: string, value: JsonValue): PluginSettingsState;
}

export function createPluginSettingsStore({
  filePath,
}: {
  filePath: string;
}): PluginSettingsStore {
  const store: DebouncedJsonStore<PluginSettingsState> = debouncedJsonStore({
    debounceMs: 500,
    defaults: DEFAULTS,
    filePath,
  });

  // 照抄 plugin-state.ts 的 ensureStore 包装：zod 校验层，损坏/不合法即重置默认。
  async function ensureStore(): Promise<
    DebouncedJsonStore<PluginSettingsState>
  > {
    try {
      const raw = await store.init();
      const parsed = pluginSettingsStateSchema.parse(raw);
      if (JSON.stringify(raw) !== JSON.stringify(parsed)) {
        store.replace(parsed);
      }
    } catch (err) {
      console.warn(
        "[plugin-settings] parse failed, resetting to defaults:",
        err
      );
      await store.clear();
      await store.init();
    }
    return store;
  }

  return {
    flush: async () => {
      await (await ensureStore()).flush();
    },
    getValues: () => structuredClone(store.get().values),
    init: async () => structuredClone((await ensureStore()).get()),
    read: async () => structuredClone((await ensureStore()).get()),
    resetValue: (key) =>
      structuredClone(
        store.mutate((state) => {
          const { [key]: _removed, ...rest } = state.values;
          return { ...state, values: rest };
        })
      ),
    setValue: (key, value) =>
      structuredClone(
        store.mutate((state) => ({
          ...state,
          values: { ...state.values, [key]: value },
        }))
      ),
  };
}

let defaultStore: PluginSettingsStore | undefined;

export function getDefaultPluginSettingsStore(): PluginSettingsStore {
  if (!defaultStore) {
    defaultStore = createPluginSettingsStore({
      filePath: join(app.getPath("userData"), "plugin-settings.json"),
    });
  }
  return defaultStore;
}

export async function flushPluginSettings(): Promise<void> {
  await getDefaultPluginSettingsStore().flush();
}
