import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import {
  app,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";

export const OPEN_SETTINGS_ACCELERATOR = "CommandOrControl+,";
export const OPEN_SETTINGS_CHANNEL = PIER_BROADCAST.SETTINGS_OPEN_REQUEST;

type SettingsWebContentsLike = Pick<
  WebContents,
  "focus" | "isDestroyed" | "send"
>;

export interface OpenSettingsWindowLike {
  focus: () => void;
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  restore: () => void;
  webContents: SettingsWebContentsLike;
}

export function requestOpenSettings(win: OpenSettingsWindowLike | null): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return;
  }
  if (win.isMinimized()) {
    win.restore();
  }
  if (process.platform === "darwin") {
    app.focus({ steal: true });
  }
  win.focus();
  win.webContents.focus();
  win.webContents.send(OPEN_SETTINGS_CHANNEL);
}

export function createOpenSettingsMenuItem(
  getTargetWindow: () => OpenSettingsWindowLike | null,
  label = "Settings..."
): MenuItemConstructorOptions {
  return {
    accelerator: OPEN_SETTINGS_ACCELERATOR,
    click: () => {
      requestOpenSettings(getTargetWindow());
    },
    label,
  };
}
