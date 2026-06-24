import { BrowserWindow, type IpcMain, nativeTheme } from "electron";
import { windowManager } from "../windows/window-manager.ts";

const NATIVE_CHROME_PALETTE = {
  light: "#ffffff",
  dark: "#1e1e1e",
} as const;

type ResolvedTheme = keyof typeof NATIVE_CHROME_PALETTE;

const isMac = process.platform === "darwin";

export function registerThemeIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    "pier:theme:set-native-chrome",
    (_event, resolved: ResolvedTheme, chromeColor?: string) => {
      nativeTheme.themeSource = resolved;

      const color = chromeColor ?? NATIVE_CHROME_PALETTE[resolved];

      if (isMac) {
        // macOS: 平时 BrowserWindow 必须保持 #00000000 透明让 terminal NSView 透出,
        // 不能直接 setBackgroundColor(chromeColor) — 否则 Chromium 合成时窗口底色
        // 盖住下层 terminal NSView. 改为只记录给 window-manager 的 reload chrome
        // 缓存, did-start-loading 临时切到 chromeColor 覆盖 reload 期间非终端区域
        // 的"透到桌面"闪烁, did-finish-load 立刻切回透明.
        for (const win of BrowserWindow.getAllWindows()) {
          windowManager.setReloadChromeColor(win, color);
        }
        return;
      }
      for (const win of BrowserWindow.getAllWindows()) {
        win.setBackgroundColor(color);
      }
    }
  );
}
