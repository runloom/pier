import { RENDERER_COMMAND_CHANNEL } from "@shared/contracts/renderer-command-channels.ts";
import { app } from "electron";
import type { AppWindow } from "../windows/app-window.ts";
import { windowManager } from "../windows/window-manager.ts";

function focusRendererTarget(win: AppWindow): void {
  if (win.isMinimized()) {
    win.restore();
  }
  if (process.platform === "darwin") {
    app.focus({ steal: true });
  }
  win.focus();
  win.webContents.focus();
}

export function sendRendererCommand(
  envelope: unknown,
  windowId?: string,
  options: { focus?: boolean } = {}
): boolean {
  if (windowId) {
    const target = windowManager.get(windowId);
    if (!target || target.isDestroyed()) {
      return false;
    }
    if (options.focus) {
      focusRendererTarget(target);
    }
    target.webContents.send(RENDERER_COMMAND_CHANNEL, envelope);
    return true;
  }

  const focused =
    windowManager.getFocused() ??
    windowManager.getAll().find((win) => !win.isDestroyed()) ??
    null;
  if (!focused || focused.isDestroyed()) {
    return false;
  }
  if (options.focus) {
    focusRendererTarget(focused);
  }
  focused.webContents.send(RENDERER_COMMAND_CHANNEL, envelope);
  return true;
}
