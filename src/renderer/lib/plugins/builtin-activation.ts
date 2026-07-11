import type { RendererPluginModule } from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { closeOverlaysForPlugin } from "../../stores/plugin-overlay.store.ts";
import { createRendererPluginContext } from "./host-context.ts";
import { clearHostGroupContentForPlugin } from "./host-group-content-context.tsx";

export function activateBuiltinRendererPlugin(
  module: RendererPluginModule,
  entry: PluginRegistryEntry
): () => void {
  const dispose = module.activate(createRendererPluginContext(entry));
  return () => {
    try {
      dispose();
    } finally {
      clearHostGroupContentForPlugin(entry.manifest.id);
      closeOverlaysForPlugin(entry.manifest.id);
    }
  };
}
