import { managedPluginCatalogToItems } from "@shared/contracts/host-catalog/managed-plugin.ts";
import type { CatalogDomainSnapshot } from "@shared/contracts/host-catalog/runtime.ts";
import { emptyDomainSnapshot } from "@shared/contracts/host-catalog/runtime.ts";
import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/plugin/managed.ts";
import type { DomainSnapshotStore } from "../persist.ts";
import type { CatalogProvider } from "../types.ts";

export interface ManagedPluginCatalogProviderOptions {
  list: () => Promise<ManagedPluginCatalogSnapshot>;
  persist: DomainSnapshotStore;
  refreshOfficial: (force: boolean) => Promise<void>;
  waitReady: () => Promise<void>;
}

function toDomain(
  catalog: ManagedPluginCatalogSnapshot
): CatalogDomainSnapshot {
  return {
    ...emptyDomainSnapshot("managed-plugin"),
    fingerprint: String(catalog.checkedAt),
    items: managedPluginCatalogToItems(catalog),
  };
}

export function createManagedPluginCatalogProvider(
  options: ManagedPluginCatalogProviderOptions
): CatalogProvider {
  async function listDomain(): Promise<CatalogDomainSnapshot> {
    await options.waitReady();
    return toDomain(await options.list());
  }

  return {
    domain: "managed-plugin",
    persist: (snapshot) => options.persist.write(snapshot),
    probeLocal: () => listDomain(),
    probeRemote: async (env) => {
      await options.waitReady();
      await options.refreshOfficial(env.force === true);
      return toDomain(await options.list());
    },
    readPersisted: () => options.persist.read(),
  };
}
