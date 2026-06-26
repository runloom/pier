import type { TerminalNativePresentationSnapshot } from "@shared/contracts/terminal.ts";
import type { AppWindow } from "../windows/app-window.ts";
import { recordWebContentsRoute } from "./terminal-debug.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { applyLatestTerminalPresentation } from "./terminal-presentation.ts";

interface ActivePanelFocusState {
  kind: "terminal" | "web";
  panelId: string | null;
}

const activePanelFocusByWindowId = new Map<number, ActivePanelFocusState>();
let addonProvider: () => NativeAddon | null = () => null;

export function setTerminalFocusAddonProvider(
  provider: () => NativeAddon | null
): void {
  addonProvider = provider;
}

export function rememberActivePanelFocus(
  win: AppWindow,
  kind: "terminal" | "web",
  panelId: string | null
): void {
  activePanelFocusByWindowId.set(win.id, { kind, panelId });
}

function focusWebContentsForEffectivePresentation(
  win: AppWindow,
  effective: TerminalNativePresentationSnapshot,
  reason: string
): void {
  if (
    effective.activePanelKind !== "web" ||
    !effective.windowFocused ||
    win.webContents.isDestroyed()
  ) {
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
    const effective = applyLatestTerminalPresentation(
      win,
      addonProvider(),
      "window-focus",
      { windowFocused: true }
    );
    focusWebContentsForEffectivePresentation(
      win,
      effective,
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
    applyLatestTerminalPresentation(win, addonProvider(), "window-blur", {
      windowFocused: false,
    });
  } catch (err) {
    console.error("[pier-blur-terminal-focus] failed:", err);
  }
}

export { focusWebContentsForEffectivePresentation };
