import { join } from "node:path";
import type {
  CatalogDomainId,
  CatalogDomainSnapshot,
} from "@shared/contracts/host-catalog/runtime.ts";
import {
  catalogDomainSnapshotSchema,
  emptyDomainSnapshot,
} from "@shared/contracts/host-catalog/runtime.ts";
import { debouncedJsonStore } from "../../state/debounced-store.ts";

export function agentInventoryPath(userDataDir: string): string {
  return join(userDataDir, "agent-inventory.json");
}

export function appUpdateLastCheckPath(userDataDir: string): string {
  return join(userDataDir, "app-update-last-check.json");
}

export function managedPluginCatalogPath(userDataDir: string): string {
  return join(userDataDir, "managed-plugin-catalog.json");
}

export interface DomainSnapshotStore {
  flush(): Promise<void>;
  read(): Promise<CatalogDomainSnapshot>;
  write(snapshot: CatalogDomainSnapshot): Promise<void>;
}

export function createDomainSnapshotStore(
  filePath: string,
  domain: CatalogDomainId
): DomainSnapshotStore {
  const defaults = emptyDomainSnapshot(domain);
  const store = debouncedJsonStore<CatalogDomainSnapshot>({
    defaults,
    filePath,
  });

  return {
    async read() {
      const raw = await store.init();
      const parsed = catalogDomainSnapshotSchema.safeParse(raw);
      if (!parsed.success || parsed.data.domain !== domain) {
        await store.clear();
        return emptyDomainSnapshot(domain);
      }
      return parsed.data;
    },
    async write(snapshot) {
      await store.init();
      store.replace(snapshot);
    },
    flush: () => store.flush(),
  };
}
