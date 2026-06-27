import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { rendererPluginRuntime } from "./runtime.ts";

export async function refreshBuiltinPlugins(
  entries?: readonly PluginRegistryEntry[]
): Promise<void> {
  try {
    if (entries) {
      rendererPluginRuntime.refresh(entries);
      return;
    }
    const result = await window.pier.plugins.list();
    rendererPluginRuntime.refresh(result.entries);
  } catch {
    rendererPluginRuntime.dispose();
  }
}

export async function bootstrapBuiltinPlugins(): Promise<() => void> {
  await refreshBuiltinPlugins();
  return () => {
    rendererPluginRuntime.dispose();
  };
}
