import type { IpcMain } from "electron";
import { appCore } from "../app-core/app-core.ts";

export function registerWorkspaceIpc(ipcMain: IpcMain): void {
  ipcMain.handle("pier:workspace:load-layout", async () =>
    appCore.services.workspace.readLayout()
  );
  ipcMain.handle(
    "pier:workspace:save-layout",
    async (_event, layout: unknown) => {
      await appCore.services.workspace.saveLayout(layout);
    }
  );
  ipcMain.handle("pier:workspace:clear-layout", async () =>
    appCore.services.workspace.clearLayout()
  );
}
