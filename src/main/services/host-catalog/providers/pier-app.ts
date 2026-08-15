import type { AppUpdateSnapshot } from "@shared/contracts/app-update.ts";
import {
  PIER_APP_ITEM_ID,
  pierAppItemFromStatus,
} from "@shared/contracts/host-catalog/pier-app.ts";
import { emptyDomainSnapshot } from "@shared/contracts/host-catalog/runtime.ts";
import type { DomainSnapshotStore } from "../persist.ts";
import type { CatalogProvider } from "../types.ts";

export interface PierAppCatalogProviderOptions {
  getStatus: () => AppUpdateSnapshot;
  persist: DomainSnapshotStore;
}

export function createPierAppCatalogProvider(
  options: PierAppCatalogProviderOptions
): CatalogProvider {
  return {
    domain: "pier-app",
    persist: (snapshot) => options.persist.write(snapshot),
    async probeLocal() {
      const persisted = await options.persist.read();
      const previousRemote =
        persisted.items.find((item) => item.id === PIER_APP_ITEM_ID)
          ?.remoteVersion ?? null;
      return {
        ...emptyDomainSnapshot("pier-app"),
        fingerprint: options.getStatus().currentVersion,
        items: [pierAppItemFromStatus(options.getStatus(), previousRemote)],
      };
    },
    readPersisted: () => options.persist.read(),
  };
}
