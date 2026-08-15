import {
  catalogEnsureFreshRequestSchema,
  emptyCatalogSnapshot,
} from "@shared/contracts/host-catalog/runtime.ts";
import { PIER } from "@shared/ipc-channels.ts";
import type { IpcMain } from "electron";
import { appCore } from "../app-core/index.ts";

export function registerHostCatalogIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    PIER.HOST_CATALOG_SNAPSHOT,
    () => appCore.services.hostCatalog?.snapshot() ?? emptyCatalogSnapshot()
  );

  ipcMain.handle(
    PIER.HOST_CATALOG_ENSURE_FRESH,
    async (_event, raw: unknown) => {
      const request = catalogEnsureFreshRequestSchema.parse(raw);
      const runtime = appCore.services.hostCatalog;
      if (!runtime) {
        throw new Error("host-catalog: runtime is not available");
      }
      return runtime.ensureFresh(request.domain, {
        ...(request.class === undefined ? {} : { class: request.class }),
        ...(request.force === undefined ? {} : { force: request.force }),
      });
    }
  );
}
