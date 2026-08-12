import type {
  LspProviderDescriptor,
  LspServerProvider,
} from "@shared/contracts/lsp-provider.ts";
import type { PluginLanguageServerContribution } from "@shared/contracts/plugin.ts";
import { createPathLspProvider } from "./providers/create-path-provider.ts";
import type { LspServerRegistry } from "./server-registry.ts";

export function pluginLanguageServerProviderId(
  pluginId: string,
  contributionId: string
): string {
  return `${pluginId}:${contributionId}`;
}

export function descriptorFromPluginContribution(
  pluginId: string,
  contribution: PluginLanguageServerContribution
): LspProviderDescriptor {
  return {
    args: contribution.args ?? [],
    command: contribution.command,
    ...(contribution.commandCandidates
      ? { commandCandidates: contribution.commandCandidates }
      : {}),
    ...(contribution.launchCandidates
      ? { launchCandidates: contribution.launchCandidates }
      : {}),
    displayName: contribution.displayName,
    extensions: contribution.extensions,
    id: pluginLanguageServerProviderId(pluginId, contribution.id),
    ...(contribution.installCommand
      ? { installCommand: contribution.installCommand }
      : {}),
    ...(contribution.languageIdByExtension
      ? { languageIdByExtension: contribution.languageIdByExtension }
      : {}),
    languageIds: contribution.languageIds,
    ...(contribution.basenameMatchers
      ? { basenameMatchers: contribution.basenameMatchers }
      : {}),
    pluginId,
    priority: contribution.priority ?? 70,
    rootMarkers: contribution.rootMarkers ?? [],
    source: "plugin",
  };
}

export function createPluginLanguageServerProvider(
  pluginId: string,
  contribution: PluginLanguageServerContribution
): LspServerProvider {
  return createPathLspProvider(
    descriptorFromPluginContribution(pluginId, contribution)
  );
}

/**
 * Register manifest languageServers for a plugin. Returns disposer that
 * unregisters all providers registered in this call.
 */
export function registerPluginLanguageServers(input: {
  contributions: readonly PluginLanguageServerContribution[];
  onBeforeUnregister?: (providerId: string) => void | Promise<void>;
  pluginId: string;
  registry: LspServerRegistry;
}): () => void {
  const registered: Array<{ id: string; unregister: () => void }> = [];
  for (const contribution of input.contributions) {
    const provider = createPluginLanguageServerProvider(
      input.pluginId,
      contribution
    );
    if (input.registry.getById(provider.id)) {
      throw new Error(`LSP provider already registered: ${provider.id}`);
    }
    const unregister = input.registry.register(provider);
    registered.push({ id: provider.id, unregister });
  }
  return () => {
    for (const entry of registered.reverse()) {
      const before = input.onBeforeUnregister?.(entry.id);
      if (before !== undefined && before !== null) {
        Promise.resolve(before)
          .catch(() => {
            /* best-effort pre-unregister cleanup */
          })
          .finally(() => {
            entry.unregister();
          });
      } else {
        entry.unregister();
      }
    }
  };
}
