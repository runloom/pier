import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  closePluginOverlay,
  openPluginOverlay,
} from "../../stores/plugin-overlay.store.ts";

/**
 * 插件 overlay API 工厂:匿名 context (无 entry) 时为 no-op。
 * 从 host-context.ts 抽出以维持 500 行硬顶。
 */
export function createPluginOverlaysApi(
  entry: PluginRegistryEntry | undefined
): RendererPluginContext["overlays"] {
  return {
    close: (id) => {
      if (!entry) {
        return;
      }
      closePluginOverlay(entry.manifest.id, id);
    },
    open: (overlay) => {
      if (!entry) {
        return;
      }
      openPluginOverlay(entry.manifest.id, overlay);
    },
  };
}
