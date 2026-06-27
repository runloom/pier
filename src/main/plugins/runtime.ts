import type { MainPluginContext, MainPluginModule } from "@plugins/api/main.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { BUILTIN_MAIN_PLUGIN_MODULES } from "./builtin-catalog.ts";

function indexModules(
  modules: readonly MainPluginModule[]
): ReadonlyMap<string, MainPluginModule> {
  return new Map(modules.map((module) => [module.id, module]));
}

function createMainPluginContext(): MainPluginContext {
  return {};
}

export class MainPluginRuntime {
  private readonly disposers = new Map<string, () => void>();
  private readonly modules: ReadonlyMap<string, MainPluginModule>;

  constructor(
    modules: readonly MainPluginModule[] = BUILTIN_MAIN_PLUGIN_MODULES
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
    const nextActiveIds = new Set<string>();
    const context = createMainPluginContext();

    for (const entry of entries) {
      if (!(entry.enabled && entry.source.kind === "builtin")) {
        continue;
      }
      const module = this.modules.get(entry.id);
      if (!module) {
        continue;
      }
      nextActiveIds.add(entry.id);
      if (this.disposers.has(entry.id)) {
        continue;
      }
      this.disposers.set(entry.id, module.activate(context));
    }

    for (const [id, dispose] of this.disposers) {
      if (nextActiveIds.has(id)) {
        continue;
      }
      dispose();
      this.disposers.delete(id);
    }
  }
}
