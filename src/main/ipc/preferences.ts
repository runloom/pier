import type { IpcMain } from "electron";
import {
  type ProjectPreferences,
  readPreferences,
  updatePreferences,
} from "../state/preferences.ts";

export function registerPreferencesIpc(ipcMain: IpcMain): void {
  ipcMain.handle("pier:preferences:read", async () => readPreferences());

  ipcMain.handle(
    "pier:preferences:update",
    async (_event, patch: Partial<ProjectPreferences>) =>
      updatePreferences(patch)
  );
}
