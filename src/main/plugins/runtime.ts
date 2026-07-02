import type { MainPluginContext, MainPluginModule } from "@plugins/api/main.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";

export type MainPluginContextFactory = (
  entry: PluginRegistryEntry,
  entries: readonly PluginRegistryEntry[]
) => MainPluginContext;

function indexModules(
  modules: readonly MainPluginModule[]
): ReadonlyMap<string, MainPluginModule> {
  return new Map(modules.map((module) => [module.id, module]));
}

export class MainPluginRuntime {
  private readonly createContext: MainPluginContextFactory;
  private readonly disposers = new Map<string, () => void>();
  private readonly modules: ReadonlyMap<string, MainPluginModule>;

  constructor(
    modules: readonly MainPluginModule[],
    createContext: MainPluginContextFactory
  ) {
    this.modules = indexModules(modules);
    this.createContext = createContext;
  }

  dispose(): void {
    for (const dispose of this.disposers.values()) {
      dispose();
    }
    this.disposers.clear();
  }

  refresh(entries: readonly PluginRegistryEntry[]): void {
    const nextActiveIds = new Set<string>();

    for (const entry of entries) {
      if (!(entry.runtime.enabled && entry.runtime.kind === "builtin")) {
        continue;
      }
      const module = this.modules.get(entry.manifest.id);
      if (!module) {
        continue;
      }
      nextActiveIds.add(entry.manifest.id);
      if (this.disposers.has(entry.manifest.id)) {
        continue;
      }
      // 按插件创建 context — set/reset 的所有权断言需要插件身份。
      this.disposers.set(
        entry.manifest.id,
        module.activate(this.createContext(entry, entries))
      );
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
