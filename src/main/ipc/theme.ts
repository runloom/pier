import type { ThemePreference } from "@shared/contracts/preferences.ts";
import type { ThemeSystemAppearancePayload } from "@shared/contracts/theme/system-appearance.ts";
import type { ThemeVisualPreviewPayload } from "@shared/contracts/theme/visual-preview.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { NATIVE_CHROME_FALLBACK } from "@shared/theme-colors.ts";
import { type IpcMain, type IpcMainInvokeEvent, nativeTheme } from "electron";
import { windowManager } from "../windows/manager.ts";

const isMac = process.platform === "darwin";
let nativeThemeUpdatedAttached = false;

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

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

function fallbackChromeColor(themeSource: ThemePreference): string {
  if (themeSource === "light" || themeSource === "dark") {
    return NATIVE_CHROME_FALLBACK[themeSource];
  }
  return nativeTheme.shouldUseDarkColors
    ? NATIVE_CHROME_FALLBACK.dark
    : NATIVE_CHROME_FALLBACK.light;
}

function applyNativeChromeColor(color: string): void {
  if (isMac) {
    // macOS: 窗口与 WebContentsView backing 同为不透明兜底色。透明 backing
    // 会让部分重绘保留旧帧像素；终端可见性由 TerminalHoleMask 硬裁保证。
    for (const win of windowManager.getAll()) {
      windowManager.setNativeChromeColor(win, color);
    }
    return;
  }
  for (const win of windowManager.getAll()) {
    win.setBackgroundColor(color);
  }
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

function broadcastSystemAppearance(): void {
  const payload: ThemeSystemAppearancePayload = {
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
  };
  for (const win of windowManager.getAll()) {
    if (win.webContents.isDestroyed()) {
      continue;
    }
    win.webContents.send(PIER_BROADCAST.THEME_SYSTEM_APPEARANCE, payload);
  }
}

export function registerThemeIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    PIER.THEME_SET_NATIVE_CHROME,
    (_event, themeSource: unknown, chromeColor?: unknown) => {
      if (!isThemePreference(themeSource)) {
        return;
      }
      // 必须写偏好本身（含 system）。写成已解析的 light/dark 会锁死
      // Chromium prefers-color-scheme，系统外观变化不再到达 renderer。
      if (nativeTheme.themeSource !== themeSource) {
        nativeTheme.themeSource = themeSource;
      }

      const color =
        typeof chromeColor === "string"
          ? chromeColor
          : fallbackChromeColor(themeSource);
      applyNativeChromeColor(color);
    }
  );

  ipcMain.handle(PIER.THEME_PREVIEW_VISUAL, (event, payload: unknown) => {
    if (!isThemeVisualPreviewPayload(payload)) {
      return;
    }
    broadcastThemeVisualPreview(event.sender, payload);
  });

  if (nativeThemeUpdatedAttached) {
    return;
  }
  nativeTheme.on("updated", broadcastSystemAppearance);
  nativeThemeUpdatedAttached = true;
}
