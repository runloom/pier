import type { RendererPluginModule } from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { closeOverlaysForPlugin } from "../../stores/plugin-overlay.store.ts";
import { BUILTIN_RENDERER_PLUGIN_MODULES } from "./builtin-catalog.ts";
import { createRendererPluginContext } from "./host-context.ts";

function indexModules(
  modules: readonly RendererPluginModule[]
): ReadonlyMap<string, RendererPluginModule> {
  return new Map(modules.map((module) => [module.id, module]));
}

export class RendererPluginRuntime {
  private readonly disposers = new Map<string, () => void>();
  private readonly modules: ReadonlyMap<string, RendererPluginModule>;

  constructor(
    modules: readonly RendererPluginModule[] = BUILTIN_RENDERER_PLUGIN_MODULES
  ) {
    this.modules = indexModules(modules);
  }

  dispose(): void {
    for (const dispose of this.disposers.values()) {
      dispose();
    }
    this.disposers.clear();
  }

  refresh(entries: readonly PluginRegistryEntry[]): void {
    this.dispose();
    for (const entry of entries) {
      if (!(entry.runtime.enabled && entry.runtime.kind === "builtin")) {
        continue;
      }
      const module = this.modules.get(entry.manifest.id);
      if (!module) {
        continue;
      }
      const context = createRendererPluginContext(entry);
      const dispose = module.activate(context);
      this.disposers.set(entry.manifest.id, () => {
        dispose();
        closeOverlaysForPlugin(entry.manifest.id);
      });
    }
  }
}

export const rendererPluginRuntime = new RendererPluginRuntime();
