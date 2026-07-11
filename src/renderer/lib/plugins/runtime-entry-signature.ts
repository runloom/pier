import type { RendererPluginModule } from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";

export function indexRendererPluginModules(
  modules: readonly RendererPluginModule[]
): ReadonlyMap<string, RendererPluginModule> {
  return new Map(modules.map((module) => [module.id, module]));
}

export function desiredRendererEntries(
  entries: readonly PluginRegistryEntry[]
): Map<string, PluginRegistryEntry> {
  return new Map(
    entries
      .filter(
        (entry) =>
          entry.runtime.enabled &&
          (entry.runtime.kind === "builtin" ||
            entry.runtime.kind === "external")
      )
      .map((entry) => [entry.manifest.id, entry])
  );
}

export function runtimeEntrySignature(entry: PluginRegistryEntry): string {
  return [
    entry.runtime.kind,
    entry.runtime.kind === "external" ? entry.runtime.rendererEntryUrl : "",
    entry.runtime.kind === "external" ? entry.runtime.sourceRevision : "",
    entry.manifest.version,
  ].join(":");
}

export function desiredExternalSignature(
  entries: ReadonlyMap<string, PluginRegistryEntry>,
  pluginId: string
): string | null {
  const entry = entries.get(pluginId);
  return entry?.runtime.kind === "external"
    ? runtimeEntrySignature(entry)
    : null;
}
