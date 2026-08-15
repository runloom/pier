import { managedPluginCatalogToItems } from "@shared/contracts/host-catalog/managed-plugin.ts";
import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/plugin/managed.ts";
import { useHostCatalogStore } from "@/stores/host-catalog/store.ts";

export function applyManagedPluginCatalog(
  snapshot: ManagedPluginCatalogSnapshot
) {
  const domain = {
    domain: "managed-plugin" as const,
    fingerprint: null,
    items: managedPluginCatalogToItems(snapshot),
    localProbedAt: 1,
    remoteCheckedAt: snapshot.checkedAt,
    revision: Date.now(),
  };
  useHostCatalogStore.getState().applyDomain(domain);
  return domain;
}

export function catalogApiFromManaged(managed: {
  checkUpdates: () => Promise<ManagedPluginCatalogSnapshot>;
  list: () => Promise<ManagedPluginCatalogSnapshot>;
}) {
  return {
    ensureFresh: async (request?: { class?: string }) => {
      const snapshot =
        request?.class === "remote"
          ? await managed.checkUpdates()
          : await managed.list();
      return {
        domain: "managed-plugin" as const,
        fingerprint: null,
        items: managedPluginCatalogToItems(snapshot),
        localProbedAt: 1,
        remoteCheckedAt: snapshot.checkedAt,
        revision: Date.now(),
      };
    },
  };
}
