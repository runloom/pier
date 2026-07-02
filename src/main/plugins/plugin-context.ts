import type { MainPluginContext } from "@plugins/api/main.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  collectEnabledConfigurationProperties,
  createConfigurationChangeEvent,
  effectiveConfigurationValue,
} from "@shared/plugin-settings.ts";
import type { PluginSettingsService } from "../services/plugin-settings-service.ts";

function assertOwnedConfigurationKey(
  entry: PluginRegistryEntry,
  key: string
): void {
  // 对齐 renderer 侧 assertDeclaredContribution 的"贡献点操作不越权"惯例。
  if (!key.startsWith(`${entry.manifest.id}.`)) {
    throw new Error(
      `plugin configuration key not owned: ${entry.manifest.id}:${key}`
    );
  }
}

export function createMainPluginContext({
  getEntries,
  entry,
  settings,
}: {
  getEntries: () => readonly PluginRegistryEntry[];
  entry: PluginRegistryEntry;
  settings: PluginSettingsService;
}): MainPluginContext {
  function effectiveValue(key: string): unknown {
    // 现算而非冻结快照 — registry 变化后跨插件 get() 需读到最新 schema（F6）。
    // main 端调用频率低，现算优于带版本号缓存的复杂度。
    const properties = collectEnabledConfigurationProperties(getEntries());
    const property = properties.get(key);
    const userValue = settings.getValues()[key];
    return property
      ? effectiveConfigurationValue(property, userValue)
      : userValue;
  }

  return {
    configuration: {
      get: <T>(key: string): T => effectiveValue(key) as T,
      onDidChange: (listener) =>
        settings.onDidChange((payload) => {
          listener(createConfigurationChangeEvent(payload.changedKeys));
        }),
      reset: async (key) => {
        assertOwnedConfigurationKey(entry, key);
        await settings.reset(key);
      },
      set: async (key, value) => {
        assertOwnedConfigurationKey(entry, key);
        await settings.set(key, value);
      },
    },
  };
}
