import type { PluginConfigurationApi } from "./configuration.ts";

export interface MainPluginContext {
  configuration: PluginConfigurationApi;
}

export interface MainPluginModule {
  activate(context: MainPluginContext): () => void;
  id: string;
}
