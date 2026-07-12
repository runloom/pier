import { BUILTIN_PLUGIN_SOURCES } from "../plugins/builtin-catalog.ts";
import type { PluginDiscoverySource } from "./plugin-service.ts";

export async function createDefaultPluginSources(): Promise<
  PluginDiscoverySource[]
> {
  return [...BUILTIN_PLUGIN_SOURCES];
}
