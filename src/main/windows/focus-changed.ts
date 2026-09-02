import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import type { AppWindow } from "./app-window.ts";

/** Push OS key-window focus to the owning renderer (tab S3 chrome, etc.). */
export function sendWindowFocusChanged(
  window: AppWindow,
  focused: boolean
): void {
  if (window.webContents.isDestroyed()) {
    return;
  }
  window.webContents.send(PIER_BROADCAST.WINDOW_FOCUS_CHANGED, { focused });
}
