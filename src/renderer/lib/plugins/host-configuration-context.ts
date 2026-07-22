import type { PluginConfigurationApi } from "@plugins/api/configuration.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  collectEnabledConfigurationProperties,
  createConfigurationChangeEvent,
  effectiveConfigurationValue,
} from "@shared/plugin-settings.ts";
import { usePluginRegistryStore } from "../../stores/plugin-registry.store.ts";
import {
  subscribePluginSettingsChanges,
  usePluginSettingsStore,
} from "../../stores/plugin-settings.store.ts";

export function createPluginConfiguration(
  entry?: PluginRegistryEntry
): PluginConfigurationApi {
  const assertOwnedKey = (key: string): void => {
    // 与 assertDeclaredContribution 同惯例：宿主内部 context（无 entry）不受限。
    if (!entry) {
      return;
    }
    if (!key.startsWith(`${entry.manifest.id}.`)) {
      throw new Error(
        `plugin configuration key not owned: ${entry.manifest.id}:${key}`
      );
    }
  };
  const effectiveValue = (key: string): unknown => {
    const property = collectEnabledConfigurationProperties(
      usePluginRegistryStore.getState().plugins
    ).get(key);
    const userValue = usePluginSettingsStore.getState().values[key];
    return property
      ? effectiveConfigurationValue(property, userValue)
      : userValue;
  };
  return {
    get: <T>(key: string): T => effectiveValue(key) as T,
    onDidChange: (listener) =>
      subscribePluginSettingsChanges((changedKeys) => {
        listener(createConfigurationChangeEvent(changedKeys));
      }),
    reset: async (key) => {
      assertOwnedKey(key);
      await usePluginSettingsStore.getState().reset(key);
    },
    set: async (key, value) => {
      assertOwnedKey(key);
      await usePluginSettingsStore.getState().set(key, value);
    },
  };
}
