import type { PluginRegistryListResult } from "@shared/contracts/plugin.ts";
import type { PluginService } from "../services/plugin-service.ts";
import type { PluginSettingsService } from "../services/plugin-settings-service.ts";
import { BUILTIN_MAIN_PLUGIN_MODULES } from "./builtin-catalog.ts";
import { createMainPluginContext } from "./plugin-context.ts";
import { MainPluginRuntime } from "./runtime.ts";

export interface MainPluginRuntimeController {
  dispose?(): void;
  refresh(entries: Parameters<MainPluginRuntime["refresh"]>[0]): void;
}

export interface MainPluginHostApi {
  dispose(): void;
  plugins: PluginService;
  refresh(): Promise<void>;
}

export function createMainPluginHostApi({
  onRegistryChanged,
  plugins,
  settings,
  runtime = new MainPluginRuntime(
    BUILTIN_MAIN_PLUGIN_MODULES,
    (entry, entries) => createMainPluginContext({ entries, entry, settings })
  ),
}: {
  /**
   * registry 快照变化后的回调 — setEnabled 与显式 refresh 皆经此路径,
   * app-core 用它把最新快照广播到所有窗口 (PIER_BROADCAST.PLUGINS_CHANGED).
   */
  onRegistryChanged?: (result: PluginRegistryListResult) => void;
  plugins: PluginService;
  settings: PluginSettingsService;
  runtime?: MainPluginRuntimeController;
}): MainPluginHostApi {
  async function refresh(): Promise<void> {
    // plugin-settings store 的异步 init 必须先于 runtime.refresh 完成，
    // 保证插件 activate 期间 context.configuration.get() 同步可用。
    await settings.init();
    const result = await plugins.list();
    runtime.refresh(result.entries);
    onRegistryChanged?.(result);
  }

  const wrappedPlugins: PluginService = {
    inspect: (id) => plugins.inspect(id),
    list: () => plugins.list(),
    setEnabled: async (id, enabled) => {
      const entry = await plugins.setEnabled(id, enabled);
      await refresh();
      return entry;
    },
  };

  return {
    dispose: () => runtime.dispose?.(),
    plugins: wrappedPlugins,
    refresh,
  };
}
