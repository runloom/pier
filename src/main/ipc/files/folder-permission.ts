import { PIER } from "@shared/ipc-channels.ts";
import type { IpcMain } from "electron";
import { openMacFolderPermissionSettings } from "../../services/files/folder-permission-settings.ts";

export function registerFilesFolderPermissionIpc(ipcMain: IpcMain): void {
  ipcMain.handle(PIER.FILES_OPEN_FOLDER_PERMISSION_SETTINGS, () =>
    openMacFolderPermissionSettings()
  );
}
