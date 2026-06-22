import { BrowserWindow, type IpcMain, nativeTheme } from "electron";

const NATIVE_CHROME_PALETTE = {
  light: "#ffffff",
  dark: "#1e1e1e",
} as const;

type ResolvedTheme = keyof typeof NATIVE_CHROME_PALETTE;

export function registerThemeIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    "pier:theme:set-native-chrome",
    (_event, resolved: ResolvedTheme) => {
      nativeTheme.themeSource = resolved;
      const color = NATIVE_CHROME_PALETTE[resolved];
      for (const win of BrowserWindow.getAllWindows()) {
        win.setBackgroundColor(color);
      }
    }
  );
}
