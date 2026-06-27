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
  plugins,
  runtime = new MainPluginRuntime(),
}: {
  plugins: PluginService;
  runtime?: MainPluginRuntimeController;
}): MainPluginHostApi {
  async function refresh(): Promise<void> {
    const result = await plugins.list();
    runtime.refresh(result.entries);
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
