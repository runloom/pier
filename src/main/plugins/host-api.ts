import type { PluginRegistryListResult } from "@shared/contracts/plugin.ts";
import type { PluginService } from "../services/plugin-service.ts";
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
  runtime = new MainPluginRuntime(),
}: {
  /**
   * registry 快照变化后的回调 — setEnabled 与显式 refresh 皆经此路径,
   * app-core 用它把最新快照广播到所有窗口 (PIER_BROADCAST.PLUGINS_CHANGED).
   */
  onRegistryChanged?: (result: PluginRegistryListResult) => void;
  plugins: PluginService;
  runtime?: MainPluginRuntimeController;
}): MainPluginHostApi {
  async function refresh(): Promise<void> {
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
