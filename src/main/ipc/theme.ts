import type { ThemeVisualPreviewPayload } from "@shared/contracts/theme-visual-preview.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { NATIVE_CHROME_FALLBACK } from "@shared/theme-colors.ts";
import { type IpcMain, type IpcMainInvokeEvent, nativeTheme } from "electron";
import { windowManager } from "../windows/manager.ts";

type ResolvedTheme = keyof typeof NATIVE_CHROME_FALLBACK;

const isMac = process.platform === "darwin";

function isThemeVisualPreviewPayload(
  value: unknown
): value is ThemeVisualPreviewPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<ThemeVisualPreviewPayload>;
  return (
    typeof candidate.theme === "string" &&
    typeof candidate.stylePresetId === "string"
  );
}

/**
 * Broadcast ephemeral theme visual to other BrowserWindows (not sender).
 * Used by command palette hover preview before preferences are committed.
 */
export function broadcastThemeVisualPreview(
  sender: IpcMainInvokeEvent["sender"],
  payload: ThemeVisualPreviewPayload
): void {
  for (const win of windowManager.getAll()) {
    if (win.webContents.isDestroyed()) {
      continue;
    }
    if (win.webContents.id === sender.id) {
      continue;
    }
    win.webContents.send(PIER_BROADCAST.THEME_VISUAL_PREVIEW, payload);
  }
}

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

  ipcMain.handle(PIER.THEME_PREVIEW_VISUAL, (event, payload: unknown) => {
    if (!isThemeVisualPreviewPayload(payload)) {
      return;
    }
    broadcastThemeVisualPreview(event.sender, payload);
  });
}
