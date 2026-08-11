import type { LspCatalogStatusRow } from "@shared/contracts/lsp-provider.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { type IpcMainInvokeEvent, ipcMain } from "electron";
import { resolveCssImportOnDisk } from "../services/lsp/css-import-resolve-fs.ts";
import {
  catalogRowsFromRegistry,
  probeCoreLspCatalog,
} from "../services/lsp/probe-catalog.ts";
import type { LspServerRegistry } from "../services/lsp/server-registry.ts";
import { isTrustedMainFrame } from "./trusted-main-frame.ts";

export function registerLspCatalogIpc(input: {
  ensureClientHasFileRead: (sender: Electron.WebContents) => boolean;
  registry: LspServerRegistry;
}): void {
  ipcMain.handle(
    PIER.LSP_CATALOG_STATUS,
    (event: IpcMainInvokeEvent): LspCatalogStatusRow[] | null => {
      if (
        !(
          isTrustedMainFrame(event) &&
          input.ensureClientHasFileRead(event.sender)
        )
      ) {
        return null;
      }
      return [
        ...probeCoreLspCatalog(),
        ...catalogRowsFromRegistry(input.registry),
      ];
    }
  );

  ipcMain.handle(
    PIER.LSP_RESOLVE_CSS_IMPORT,
    (
      event: IpcMainInvokeEvent,
      payload: unknown
    ): { isDirectory: boolean; path: string } | null => {
      if (
        !(
          isTrustedMainFrame(event) &&
          input.ensureClientHasFileRead(event.sender)
        )
      ) {
        return null;
      }
      if (!payload || typeof payload !== "object") {
        return null;
      }
      const record = payload as {
        allowDirectory?: unknown;
        fromFilePath?: unknown;
        specifier?: unknown;
      };
      if (
        typeof record.fromFilePath !== "string" ||
        record.fromFilePath.length === 0 ||
        typeof record.specifier !== "string" ||
        record.specifier.length === 0
      ) {
        return null;
      }
      return resolveCssImportOnDisk({
        ...(record.allowDirectory === true ? { allowDirectory: true } : {}),
        fromFilePath: record.fromFilePath,
        specifier: record.specifier,
      });
    }
  );
}
