import type { LspCustomServer } from "@shared/contracts/lsp.ts";
import type { LspServerProvider } from "@shared/contracts/lsp-provider.ts";
import type { PluginLanguageServerContribution } from "@shared/contracts/plugin.ts";
import { registerPluginLanguageServers } from "./plugin-language-servers.ts";
import { createPathLspProvider } from "./providers/create-path-provider.ts";
import type { LspServerRegistry } from "./server-registry.ts";
import type { LspSessionHost } from "./session-host.ts";

interface LspHostBridge {
  host: LspSessionHost;
  registry: LspServerRegistry;
}

let bridge: LspHostBridge | null = null;
let customServerDisposer: (() => void) | null = null;

/** Bound once when LSP IPC host starts. */
export function bindLspHostBridge(next: LspHostBridge): void {
  bridge = next;
}

export function unbindLspHostBridge(): void {
  customServerDisposer?.();
  customServerDisposer = null;
  bridge = null;
}

export function getLspHostBridge(): LspHostBridge | null {
  return bridge;
}

/**
 * Replace all user custom language servers (provider id `custom:{id}`).
 */
export function syncCustomLanguageServers(
  servers: readonly LspCustomServer[]
): void {
  const current = bridge;
  if (!current) {
    return;
  }
  customServerDisposer?.();
  customServerDisposer = null;
  const disposers: Array<() => void> = [];
  for (const server of servers) {
    const providerId = `custom:${server.id}`;
    if (current.registry.getById(providerId)) {
      continue;
    }
    const provider = createPathLspProvider({
      args: server.args ?? [],
      command: server.command,
      ...(server.commandCandidates
        ? { commandCandidates: server.commandCandidates }
        : {}),
      displayName: server.displayName,
      extensions: server.extensions,
      id: providerId,
      ...(server.languageIdByExtension
        ? { languageIdByExtension: server.languageIdByExtension }
        : {}),
      languageIds: server.languageIds,
      priority: server.priority ?? 50,
      rootMarkers: server.rootMarkers ?? [],
      source: "custom",
    });
    const unregister = current.registry.register(provider);
    disposers.push(() => {
      const sessionIds = current.host.listSessionIdsForServer(providerId);
      if (sessionIds.length === 0) {
        unregister();
        return;
      }
      // Unregister only after sessions start closing (same order as plugins).
      current.host
        .closeMany(sessionIds, "policy-disabled")
        .catch(() => {
          /* best-effort cleanup */
        })
        .finally(() => {
          unregister();
        });
    });
  }
  customServerDisposer = () => {
    for (const dispose of disposers.reverse()) {
      dispose();
    }
  };
}

/**
 * Register plugin-contributed PATH language servers. Closes matching sessions
 * when the returned disposer runs.
 */
export function attachPluginLanguageServers(input: {
  contributions: readonly PluginLanguageServerContribution[];
  pluginId: string;
}): () => void {
  const current = bridge;
  if (!current) {
    throw new Error("LSP host bridge is not bound");
  }
  return registerPluginLanguageServers({
    contributions: input.contributions,
    pluginId: input.pluginId,
    registry: current.registry,
    onBeforeUnregister: (providerId) => {
      const sessionIds = current.host.listSessionIdsForServer(providerId);
      if (sessionIds.length === 0) {
        return;
      }
      // Return the promise so registerPluginLanguageServers unregisters in
      // `.finally()` after closeMany settles (avoids re-register races).
      return current.host
        .closeMany(sessionIds, "policy-disabled")
        .catch((error: unknown) => {
          console.error("[lsp] plugin provider session cleanup failed", {
            error,
            providerId,
          });
        });
    },
  });
}

export function registerDynamicLspProvider(
  provider: LspServerProvider
): () => void {
  const current = bridge;
  if (!current) {
    throw new Error("LSP host bridge is not bound");
  }
  return current.registry.register(provider);
}
