/**
 * Build install guides from L0 language matrix + enabled language plugins.
 * Empty/missing coreCatalog defaults to the full matrix-derived catalog so
 * editor chips always get PATH installCommand for scheme A languages.
 */

import type { LspCatalogEntry } from "@shared/contracts/lsp-provider.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  pathCatalogFromMatrix,
  SPECIAL_LSP_CATALOG_ENTRIES,
} from "@shared/language-matrix/index.ts";
import {
  type LspInstallGuide,
  lspInstallGuideRegistry,
} from "./lsp-install-guide-registry.ts";

/** Full core catalog for Files chip guides (matrix + special TS/Vue rows). */
export function defaultCoreLspCatalog(): LspCatalogEntry[] {
  return [
    ...SPECIAL_LSP_CATALOG_ENTRIES.map((entry) => ({
      binaryHint: entry.binaryHint,
      displayName: entry.displayName,
      extensions: [...entry.extensions],
      id: entry.id,
      source: entry.source,
      ...("installCommand" in entry && entry.installCommand
        ? { installCommand: entry.installCommand }
        : {}),
    })),
    ...pathCatalogFromMatrix(),
  ];
}

export function guidesFromCoreCatalog(
  catalog: readonly LspCatalogEntry[]
): LspInstallGuide[] {
  const rows = catalog.length > 0 ? catalog : defaultCoreLspCatalog();
  return rows.map((entry) => ({
    displayName: entry.displayName,
    ...(entry.installCommand ? { installCommand: entry.installCommand } : {}),
    serverIds: [entry.id],
  }));
}

export function guidesFromPluginRegistry(
  plugins: readonly PluginRegistryEntry[]
): LspInstallGuide[] {
  const guides: LspInstallGuide[] = [];
  for (const entry of plugins) {
    if (!entry.runtime.enabled) {
      continue;
    }
    if (!entry.manifest.permissions.includes("lsp:provide")) {
      continue;
    }
    const servers = entry.manifest.languageServers ?? [];
    for (const server of servers) {
      const providerId = `${entry.manifest.id}:${server.id}`;
      guides.push({
        displayName: server.displayName,
        ...(server.installCommand
          ? { installCommand: server.installCommand }
          : {}),
        serverIds: [providerId, server.id],
      });
    }
  }
  return guides;
}

export function syncLspInstallGuides(input: {
  coreCatalog?: readonly LspCatalogEntry[];
  plugins?: readonly PluginRegistryEntry[];
}): void {
  const guides = [
    ...guidesFromCoreCatalog(input.coreCatalog ?? []),
    ...(input.plugins ? guidesFromPluginRegistry(input.plugins) : []),
  ];
  lspInstallGuideRegistry.replaceAll(guides);
}
