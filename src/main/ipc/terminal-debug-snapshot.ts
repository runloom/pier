import type { TerminalDebugSnapshotArgs } from "@shared/contracts/terminal.ts";
import type { IpcMain } from "electron";
import {
  findAppWindowByElectronId,
  findAppWindowByWebContents,
} from "../windows/window-identity.ts";
import {
  readTerminalDebugSnapshot,
  readTerminalDebugSnapshotError,
  registerTerminalDebugRendererSnapshotIpc,
  requestRendererDebugSnapshot,
} from "./terminal-debug.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";

export function registerTerminalDebugSnapshotIpc(
  ipcMain: IpcMain,
  addon: NativeAddon | null
): void {
  registerTerminalDebugRendererSnapshotIpc(ipcMain);
  ipcMain.handle(
    "pier:terminal:debug-snapshot",
    async (event, args?: TerminalDebugSnapshotArgs) => {
      const win =
        typeof args?.targetBrowserWindowId === "number"
          ? findAppWindowByElectronId(args.targetBrowserWindowId)
          : findAppWindowByWebContents(event.sender);
      if (!win) {
        return readTerminalDebugSnapshotError("window not found");
      }
      const renderer = await requestRendererDebugSnapshot(win);
      return readTerminalDebugSnapshot(win, addon, renderer);
    }
  );
}
