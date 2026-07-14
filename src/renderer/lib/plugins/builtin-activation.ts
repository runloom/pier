import type { RendererPluginModule } from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { closeOverlaysForPlugin } from "../../stores/plugin-overlay.store.ts";
import { createRendererPluginContext } from "./host-context.ts";
import { clearHostGroupContentForPlugin } from "./host-group-content-context.tsx";

import { pluginLifecycleBarriers } from "./plugin-lifecycle-barriers.ts";
export function activateBuiltinRendererPlugin(
  module: RendererPluginModule,
  entry: PluginRegistryEntry
): () => void {
  const cleanupHostViews = () => {
    clearHostGroupContentForPlugin(entry.manifest.id);
    closeOverlaysForPlugin(entry.manifest.id);
  };
  let dispose: () => void;
  try {
    dispose = module.activate(createRendererPluginContext(entry));
  } catch (error) {
    pluginLifecycleBarriers.clear(entry.manifest.id);
    cleanupHostViews();
    throw error;
  }
  return () => {
    try {
      dispose();
      pluginLifecycleBarriers.clear(entry.manifest.id);
    } finally {
      cleanupHostViews();
    }
  };
}
