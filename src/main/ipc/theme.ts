import { BrowserWindow, type IpcMain, nativeTheme } from "electron";

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

      // macOS: 透明 BrowserWindow (transparent:true + backgroundColor="#00000000")
      // 让终端 NSView 透到底, 切主题不能动 backgroundColor — 否则 Chromium 合成时
      // 不透明的窗口底色会盖住下层 terminal NSView, 终端看起来全黑.
      // win-manager.ts 创建窗口时已根据 platform 区分 backgroundColor, 这里同样区分.
      if (isMac) {
        return;
      }
      const color = chromeColor ?? NATIVE_CHROME_PALETTE[resolved];
      for (const win of BrowserWindow.getAllWindows()) {
        win.setBackgroundColor(color);
      }
    }
  );
}
