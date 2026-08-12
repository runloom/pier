import type { ManagedPluginInstallIndexEntry } from "@shared/contracts/plugin/managed.ts";
import type { ManagedPluginIndexStore } from "./index-state.ts";
import { purgeRetiredManagedPluginsFromStore } from "./retired-plugins.ts";

async function clearProductionDevOverrides(
  store: ManagedPluginIndexStore
): Promise<void> {
  const state = store.get();
  let mutated = false;
  const filteredPlugins: Record<string, ManagedPluginInstallIndexEntry> = {};
  for (const [id, entry] of Object.entries(state.plugins)) {
    if (entry.devOverride) {
      filteredPlugins[id] = { ...entry, devOverride: null };
      mutated = true;
    } else {
      filteredPlugins[id] = entry;
    }
  }
  if (!mutated) return;
  store.mutate((s) => ({ ...s, plugins: filteredPlugins }));
  await store.flush();
}

/** Shared install-service boot steps after store.init(). */
export async function runManagedPluginInstallBoot(input: {
  isDevRuntime: boolean;
  paths: { installedDir: string };
  store: ManagedPluginIndexStore;
  afterBoot: () => Promise<void>;
  cleanupStaleTemps: () => Promise<void>;
  repairHashes: () => Promise<void>;
}): Promise<void> {
  await input.cleanupStaleTemps();
  await input.repairHashes();
  await purgeRetiredManagedPluginsFromStore({
    flush: () => input.store.flush(),
    getIndex: () => input.store.get(),
    installedDir: input.paths.installedDir,
    mutate: (fn) => input.store.mutate(fn),
  });
  if (!input.isDevRuntime) {
    await clearProductionDevOverrides(input.store);
  }
  await input.afterBoot();
}
