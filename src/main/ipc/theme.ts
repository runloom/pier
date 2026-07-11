import { NATIVE_CHROME_FALLBACK } from "@shared/theme-colors.ts";
import { type IpcMain, nativeTheme } from "electron";
import { windowManager } from "../windows/window-manager.ts";

type ResolvedTheme = keyof typeof NATIVE_CHROME_FALLBACK;

const isMac = process.platform === "darwin";

export function registerThemeIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    "pier:theme:set-native-chrome",
    (_event, resolved: ResolvedTheme, chromeColor?: string) => {
      nativeTheme.themeSource = resolved;

      const color = chromeColor ?? NATIVE_CHROME_FALLBACK[resolved];

      if (isMac) {
        // macOS: opaque BaseWindow 只作为兜底 backing; renderer 透明区域仍通过
        // transparent WebContentsView 透出 native terminal NSView.
        for (const win of windowManager.getAll()) {
          windowManager.setNativeChromeColor(win, color);
        }
        return;
      }
      for (const win of windowManager.getAll()) {
        win.setBackgroundColor(color);
      }
    }
  );
}
