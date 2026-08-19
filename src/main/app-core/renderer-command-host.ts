import { RENDERER_COMMAND_CHANNEL } from "@shared/contracts/renderer-command-channels.ts";
import { app } from "electron";
import type { AppWindow } from "../windows/app-window.ts";
import { findAppWindowForActivityWindowId } from "../windows/identity.ts";
import { windowManager } from "../windows/manager.ts";

function resolveRendererTargetWindow(windowId?: string): AppWindow | null {
  if (windowId) {
    const fromManager = windowManager.get(windowId);
    if (fromManager && !fromManager.isDestroyed()) {
      return fromManager;
    }
    const fromActivity = findAppWindowForActivityWindowId(windowId);
    if (fromActivity && !fromActivity.isDestroyed()) {
      return fromActivity;
    }
    return null;
  }
  return (
    windowManager.getFocused() ??
    windowManager.getAll().find((win) => !win.isDestroyed()) ??
    null
  );
}

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

/**
 * Deliver a renderer command envelope.
 * Returns the target webContents.id on success, or null when no usable window.
 */
export function sendRendererCommand(
  envelope: unknown,
  windowId?: string,
  options: { focus?: boolean } = {}
): number | null {
  const target = resolveRendererTargetWindow(windowId);
  if (!target || target.isDestroyed()) {
    return null;
  }
  if (options.focus) {
    focusRendererTarget(target);
  }
  target.webContents.send(RENDERER_COMMAND_CHANNEL, envelope);
  return target.webContents.id;
}
