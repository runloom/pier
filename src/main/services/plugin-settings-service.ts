import type { PluginConfigurationProperty } from "@shared/contracts/plugin.ts";
import type {
  JsonValue,
  PluginSettingsChangedPayload,
  PluginSettingsState,
} from "@shared/contracts/plugin-settings.ts";
import {
  collectEnabledConfigurationProperties,
  validateConfigurationValue,
} from "@shared/plugin-settings.ts";
import {
  getDefaultPluginSettingsStore,
  type PluginSettingsStore,
} from "../state/plugin-settings.ts";
import type { PluginService } from "./plugin-service.ts";

export type PluginSettingsServiceErrorCode = "invalid_command" | "not_found";

export class PluginSettingsServiceError extends Error {
  readonly code: PluginSettingsServiceErrorCode;

  constructor(code: PluginSettingsServiceErrorCode, message: string) {
    super(message);
    this.name = "PluginSettingsServiceError";
    this.code = code;
  }
}

export interface PluginSettingsService {
  getAll(): Promise<PluginSettingsState>;
  /** 同步读内存态 — 供 main 插件 context 的同步 get()；init() 已在 host refresh 前完成。 */
  getValues(): Record<string, JsonValue>;
  init(): Promise<void>;
  /** registry 变化后失效 enabled-properties 缓存 — 下次 set() 会重新 plugins.list()。 */
  invalidateCache(): void;
  onDidChange(
    listener: (payload: PluginSettingsChangedPayload) => void
  ): () => void;
  reset(key: string): Promise<PluginSettingsState>;
  set(key: string, value: JsonValue): Promise<PluginSettingsState>;
}

export function createPluginSettingsService({
  plugins,
  store = getDefaultPluginSettingsStore(),
}: {
  plugins: PluginService;
  store?: PluginSettingsStore;
}): PluginSettingsService {
  const listeners = new Set<(payload: PluginSettingsChangedPayload) => void>();
  // enabled-properties 缓存 — 避免 set() 每次都全量 plugins.list() 磁盘发现（F13）。
  // registry 变化后需经 invalidateCache() 失效；host-api 的 onRegistryChanged 路径接线。
  let propertiesCache: ReadonlyMap<string, PluginConfigurationProperty> | null =
    null;

  function emit(changedKeys: string[], state: PluginSettingsState): void {
    const payload: PluginSettingsChangedPayload = {
      changedKeys,
      values: state.values,
    };
    for (const listener of listeners) {
      listener(payload);
    }
  }

  async function getEnabledProperties(): Promise<
    ReadonlyMap<string, PluginConfigurationProperty>
  > {
    if (!propertiesCache) {
      const { entries } = await plugins.list();
      propertiesCache = collectEnabledConfigurationProperties(entries);
    }
    return propertiesCache;
  }

  return {
    getAll: async () => await store.read(),
    getValues: () => store.getValues(),
    init: async () => {
      await store.init();
    },
    invalidateCache: () => {
      propertiesCache = null;
    },
    onDidChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset: async (key) => {
      await store.init();
      const hadValue = key in store.getValues();
      const next = store.resetValue(key);
      if (hadValue) {
        emit([key], next);
      }
      return next;
    },
    set: async (key, value) => {
      const properties = await getEnabledProperties();
      const property = properties.get(key);
      if (!property) {
        throw new PluginSettingsServiceError(
          "not_found",
          `setting is not declared by any enabled plugin: ${key}`
        );
      }
      const validation = validateConfigurationValue(property, value);
      if (!validation.ok) {
        throw new PluginSettingsServiceError(
          "invalid_command",
          `invalid value for ${key}: ${validation.reason}`
        );
      }
      await store.init();
      // F5：写入值与当前存储用户值相等（Object.is）→ 短路，防 normalize-on-change 监听器死循环。
      if (Object.is(store.getValues()[key], value)) {
        return await store.read();
      }
      // resolve 语义：mutate 同步提交内存态后才 return（磁盘写防抖异步）。
      const next = store.setValue(key, value);
      emit([key], next);
      return next;
    },
  };
}
