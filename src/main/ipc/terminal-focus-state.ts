import type { TerminalNativeInputRoutingSnapshot } from "@shared/contracts/terminal.ts";
import type { AppWindow } from "../windows/app-window.ts";
import { recordWebContentsRoute } from "./terminal-debug.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { applyLatestTerminalState } from "./terminal-presentation.ts";

let addonProvider: () => NativeAddon | null = () => null;
const lastKeyboardFocusTargetByWindowId = new Map<number, string>();

export function setTerminalFocusAddonProvider(
  provider: () => NativeAddon | null
): void {
  addonProvider = provider;
}

function focusWebContentsForEffectiveInputRouting(
  win: AppWindow,
  effective: TerminalNativeInputRoutingSnapshot,
  reason: string
): void {
  const targetKey =
    effective.keyboardFocusTarget.kind === "terminal"
      ? `terminal:${effective.keyboardFocusTarget.panelId}`
      : "web";
  const previousTargetKey = lastKeyboardFocusTargetByWindowId.get(win.id);
  lastKeyboardFocusTargetByWindowId.set(win.id, targetKey);

  if (
    effective.keyboardFocusTarget.kind !== "web" ||
    !effective.windowFocused ||
    win.webContents.isDestroyed()
  ) {
    return;
  }
  if (previousTargetKey === targetKey && reason !== "terminal-window-focus") {
    return;
  }
  if (win.webContents.isFocused()) {
    return;
  }
  recordWebContentsRoute(win, "focus-webcontents", { reason });
  win.webContents.focus();
}

export function restoreActivePanelFocus(win: AppWindow): void {
  if (win.isDestroyed()) {
    return;
  }
  if (win.isMinimized()) {
    win.restore();
  }
  win.focus();

  try {
    const { inputRouting } = applyLatestTerminalState(
      win,
      addonProvider(),
      "window-focus",
      { windowFocused: true }
    );
    focusWebContentsForEffectiveInputRouting(
      win,
      inputRouting,
      "terminal-window-focus"
    );
  } catch (err) {
    console.error("[pier-restore-terminal-focus] failed:", err);
  }
}

export function blurActivePanelFocus(win: AppWindow): void {
  if (win.isDestroyed()) {
    return;
  }
  try {
    applyLatestTerminalState(win, addonProvider(), "window-blur", {
      windowFocused: false,
    });
  } catch (err) {
    console.error("[pier-blur-terminal-focus] failed:", err);
  }
}

export function clearTerminalFocusWindow(win: AppWindow): void {
  clearTerminalFocusWindowById(win.id);
}

export function clearTerminalFocusWindowById(windowId: number): void {
  lastKeyboardFocusTargetByWindowId.delete(windowId);
}

export { focusWebContentsForEffectiveInputRouting };
