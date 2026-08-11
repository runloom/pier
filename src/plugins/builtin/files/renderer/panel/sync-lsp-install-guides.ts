/**
 * Build install guides from core catalog + enabled language plugins.
 * Language plugins own their installCommand; Files only aggregates.
 */

import type { LspCatalogEntry } from "@shared/contracts/lsp-provider.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  type LspInstallGuide,
  lspInstallGuideRegistry,
} from "./lsp-install-guide-registry.ts";

/** Core L0 install guides (mirrors main CORE_LSP_CATALOG installCommand). */
export const CORE_LSP_INSTALL_GUIDES: readonly LspInstallGuide[] = [
  {
    displayName: "TypeScript",
    serverIds: ["typescript"],
  },
  {
    displayName: "Python",
    installCommand: "npm i -g pyright",
    serverIds: ["pyright"],
  },
  {
    displayName: "Go",
    installCommand: "go install golang.org/x/tools/gopls@latest",
    serverIds: ["gopls"],
  },
  {
    displayName: "Rust",
    installCommand: "rustup component add rust-analyzer",
    serverIds: ["rust-analyzer"],
  },
  {
    displayName: "JSON",
    installCommand: "npm i -g vscode-langservers-extracted",
    serverIds: ["json"],
  },
  {
    displayName: "CSS",
    installCommand: "npm i -g vscode-langservers-extracted",
    serverIds: ["css"],
  },
  {
    displayName: "HTML",
    installCommand: "npm i -g vscode-langservers-extracted",
    serverIds: ["html"],
  },
  {
    displayName: "YAML",
    installCommand: "npm i -g yaml-language-server",
    serverIds: ["yaml"],
  },
  {
    displayName: "Markdown",
    installCommand: "brew install marksman",
    serverIds: ["markdown"],
  },
  {
    displayName: "Vue",
    installCommand: "npm i -g @vue/language-server",
    serverIds: ["vue"],
  },
  {
    displayName: "Svelte",
    installCommand: "npm i -g svelte-language-server",
    serverIds: ["svelte"],
  },
];

export function guidesFromCoreCatalog(
  catalog: readonly LspCatalogEntry[] = []
): LspInstallGuide[] {
  if (catalog.length === 0) {
    return [...CORE_LSP_INSTALL_GUIDES];
  }
  return catalog.map((entry) => ({
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
    ...guidesFromCoreCatalog(input.coreCatalog),
    ...(input.plugins ? guidesFromPluginRegistry(input.plugins) : []),
  ];
  lspInstallGuideRegistry.replaceAll(guides);
}
