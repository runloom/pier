import type { IpcMain } from "electron";
import { appCore } from "../app-core/app-core.ts";

function requireRecordId(recordId: unknown): string {
  if (typeof recordId !== "string" || recordId.trim().length === 0) {
    throw new Error("workspace layout recordId required");
  }
  return recordId;
}

export function registerWorkspaceIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    "pier:workspace:load-layout",
    async (_event, recordId: unknown) =>
      appCore.services.workspace.readLayout(requireRecordId(recordId))
  );
  ipcMain.handle(
    "pier:workspace:save-layout",
    async (_event, layout: unknown, recordId: unknown) => {
      await appCore.services.workspace.saveLayout(
        layout,
        requireRecordId(recordId)
      );
    }
  );
  ipcMain.handle(
    "pier:workspace:clear-layout",
    async (_event, recordId: unknown) =>
      appCore.services.workspace.clearLayout(requireRecordId(recordId))
  );
}
