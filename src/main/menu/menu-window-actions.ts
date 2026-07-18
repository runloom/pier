import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { app } from "electron";
import type { AppWindow } from "../windows/app-window.ts";

const isMac = process.platform === "darwin";

export function focusAppWindow(target: AppWindow): void {
  if (target.isDestroyed() || target.webContents.isDestroyed()) {
    return;
  }
  if (target.isMinimized()) {
    target.restore();
  }
  if (isMac) {
    app.focus({ steal: true });
  }
  target.focus();
  target.webContents.focus();
}

export function openTerminalFromMenu(target: AppWindow | null): void {
  if (!target) {
    return;
  }
  focusAppWindow(target);
  if (target.isDestroyed() || target.webContents.isDestroyed()) {
    return;
  }
  target.webContents.send(PIER_BROADCAST.NEW_TERMINAL_REQUEST);
}

export function openTerminalSearchFromMenu(target: AppWindow | null): void {
  if (!target) {
    return;
  }
  focusAppWindow(target);
  if (target.isDestroyed() || target.webContents.isDestroyed()) {
    return;
  }
  target.webContents.send(PIER_BROADCAST.TERMINAL_SEARCH_OPEN_REQUEST);
}

export function toggleCommandPaletteFromMenu(target: AppWindow | null): void {
  if (!target) {
    return;
  }
  focusAppWindow(target);
  if (target.isDestroyed() || target.webContents.isDestroyed()) {
    return;
  }
  target.webContents.send(PIER_BROADCAST.COMMAND_PALETTE_TOGGLE_REQUEST);
}

export function prepareQuitDialogWindow(target: AppWindow): void {
  focusAppWindow(target);
}
