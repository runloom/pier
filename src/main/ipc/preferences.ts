import { BrowserWindow, type IpcMain } from "electron";
import {
  type ProjectPreferences,
  readPreferences,
  updatePreferences,
} from "../state/preferences.ts";

export function registerPreferencesIpc(ipcMain: IpcMain): void {
  ipcMain.handle("pier:preferences:read", async () => readPreferences());

  ipcMain.handle(
    "pier:preferences:update",
    async (event, patch: Partial<ProjectPreferences>) => {
      const merged = await updatePreferences(patch);
      // 广播给除 sender 外的所有窗口. 当前 renderer 只有 theme.store 订阅
      // onChanged, 所以 跨窗口同步仅覆盖 theme + stylePreset; font.store 和
      // locale.store 暂未接 listener — 跨窗口字体/语言切换需要重启目标窗口才
      // 生效. sender 自己已在 setTheme/setStylePreset await 后立即应用, 不走
      // listener 路径避免重复 set.
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.webContents.id === event.sender.id) {
          continue;
        }
        if (win.webContents.isDestroyed()) {
          continue;
        }
        win.webContents.send("pier:preferences:changed", merged);
      }
      return merged;
    }
  );
}
