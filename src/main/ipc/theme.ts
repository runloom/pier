import { type IpcMain, nativeTheme } from "electron";
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
