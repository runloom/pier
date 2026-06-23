import type { IpcMain } from "electron";
import {
  clearLayout,
  readLayout,
  saveLayout,
} from "../state/workspace-layout.ts";

export function registerWorkspaceIpc(ipcMain: IpcMain): void {
  ipcMain.handle("pier:workspace:load-layout", async () => readLayout());
  ipcMain.handle(
    "pier:workspace:save-layout",
    async (_event, layout: unknown) => {
      await saveLayout(layout);
    }
  );
  ipcMain.handle("pier:workspace:clear-layout", async () => clearLayout());
}
