/**
 * Official plugins that were retired from the product and must not stay in
 * the install index or catalog (even as "installed but not loaded").
 *
 * Language packs were collapsed into Files/L0 PATH providers (scheme A).
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { ManagedPluginInstallIndex } from "@shared/contracts/plugin/managed.ts";

export const RETIRED_MANAGED_PLUGIN_IDS: ReadonlySet<string> = new Set([
  "pier.lsp-cpp",
  "pier.lsp-csharp",
  "pier.lsp-dart",
  "pier.lsp-dockerfile",
  "pier.lsp-elixir",
  "pier.lsp-java",
  "pier.lsp-kotlin",
  "pier.lsp-lua",
  "pier.lsp-php",
  "pier.lsp-r",
  "pier.lsp-ruby",
  "pier.lsp-scala",
  "pier.lsp-shell",
  "pier.lsp-sql",
  "pier.lsp-swift",
  "pier.lsp-toml",
  "pier.lsp-zig",
]);

export function isRetiredManagedPluginId(id: string): boolean {
  return RETIRED_MANAGED_PLUGIN_IDS.has(id);
}

/**
 * Drop retired plugin entries from the install index so they no longer appear
 * as installed / unloadable rows in Settings → Plugins.
 */
export function stripRetiredManagedPlugins(state: ManagedPluginInstallIndex): {
  next: ManagedPluginInstallIndex;
  removedIds: readonly string[];
} {
  const removedIds: string[] = [];
  const plugins = { ...state.plugins };
  for (const id of Object.keys(plugins)) {
    if (!isRetiredManagedPluginId(id)) {
      continue;
    }
    delete plugins[id];
    removedIds.push(id);
  }
  if (removedIds.length === 0) {
    return { next: state, removedIds };
  }
  return {
    next: {
      ...state,
      plugins,
    },
    removedIds,
  };
}

/** Best-effort delete of installed/<id> trees for purged retired plugins. */
export async function removeRetiredInstalledPackages(
  installedDir: string,
  removedIds: readonly string[]
): Promise<void> {
  await Promise.all(
    removedIds.map(async (id) => {
      try {
        await rm(join(installedDir, id), { force: true, recursive: true });
      } catch {
        // ignore — index purge is the source of truth for UI
      }
    })
  );
}

/**
 * Drop retired plugins from the install index and remove their package trees.
 * Returns true when the index was mutated.
 */
export async function purgeRetiredManagedPluginsFromStore(input: {
  flush: () => Promise<void>;
  getIndex: () => ManagedPluginInstallIndex;
  installedDir: string;
  mutate: (
    fn: (state: ManagedPluginInstallIndex) => ManagedPluginInstallIndex
  ) => void;
}): Promise<boolean> {
  const { next, removedIds } = stripRetiredManagedPlugins(input.getIndex());
  if (removedIds.length === 0) {
    return false;
  }
  input.mutate(() => next);
  await input.flush();
  await removeRetiredInstalledPackages(input.installedDir, removedIds);
  return true;
}
