import type {
  CatalogChangedPayload,
  CatalogDomainSnapshot,
  CatalogEnsureFreshRequest,
  CatalogSnapshot,
} from "@shared/contracts/host-catalog/runtime.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

export interface PierHostCatalogAPI {
  ensureFresh: (
    request: CatalogEnsureFreshRequest
  ) => Promise<CatalogDomainSnapshot>;
  onChanged: (cb: (payload: CatalogChangedPayload) => void) => () => void;
  snapshot: () => Promise<CatalogSnapshot>;
}

export const hostCatalogApi: PierHostCatalogAPI = {
  ensureFresh: (request) =>
    ipcRenderer.invoke(PIER.HOST_CATALOG_ENSURE_FRESH, request),
  onChanged: (cb) => {
    const listener = (
      _event: unknown,
      payload: CatalogChangedPayload
    ): void => {
      cb(payload);
    };
    ipcRenderer.on(PIER_BROADCAST.HOST_CATALOG_CHANGED, listener);
    return () => {
      ipcRenderer.off(PIER_BROADCAST.HOST_CATALOG_CHANGED, listener);
    };
  },
  snapshot: () => ipcRenderer.invoke(PIER.HOST_CATALOG_SNAPSHOT),
};
