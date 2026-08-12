import type { MainPluginContext, MainPluginModule } from "@plugins/api/main.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { attachPluginLanguageServers } from "../services/lsp/host-bridge.ts";

export type MainPluginContextFactory = (
  entry: PluginRegistryEntry,
  getEntries: () => readonly PluginRegistryEntry[]
) => MainPluginContext;

function indexModules(
  modules: readonly MainPluginModule[]
): ReadonlyMap<string, MainPluginModule> {
  return new Map(modules.map((module) => [module.id, module]));
}

function attachBuiltinLanguageServers(entry: PluginRegistryEntry): () => void {
  const contributions = entry.manifest.languageServers ?? [];
  if (contributions.length === 0) {
    return () => undefined;
  }
  if (!entry.manifest.permissions.includes("lsp:provide")) {
    throw new Error(
      `plugin ${entry.manifest.id} declares languageServers without lsp:provide`
    );
  }
  return attachPluginLanguageServers({
    contributions,
    pluginId: entry.manifest.id,
  });
}

export class MainPluginRuntime {
  private readonly createContext: MainPluginContextFactory;
  private readonly disposers = new Map<string, () => void>();
  private readonly modules: ReadonlyMap<string, MainPluginModule>;
  // 最新 registry 快照 — getEntries() 现算读取，跨 refresh 保持已激活插件的 context 不陈旧（F6）。
  private latestEntries: readonly PluginRegistryEntry[] = [];

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
    this.latestEntries = entries;
    const nextActiveIds = new Set<string>();
    const getEntries = (): readonly PluginRegistryEntry[] => this.latestEntries;

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
      // getEntries 是活引用：已激活插件的 context 在后续 refresh 后仍能现算最新 registry。
      const disposeActivate = module.activate(
        this.createContext(entry, getEntries)
      );
      const disposeLsp = attachBuiltinLanguageServers(entry);
      this.disposers.set(entry.manifest.id, () => {
        disposeLsp();
        disposeActivate();
      });
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
