import type {
  TerminalNativePresentationSnapshot,
  TerminalPresentationReason,
  TerminalPresentationSnapshot,
} from "@shared/contracts/terminal.ts";
import type { AppWindow } from "../windows/app-window.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { scopePanelId } from "./terminal-panel-id.ts";

interface TerminalPresentationWindowState {
  desired?: TerminalPresentationSnapshot | undefined;
  effective?: TerminalNativePresentationSnapshot | undefined;
  overlayActive: boolean;
}

const presentationByWindowId = new Map<
  number,
  TerminalPresentationWindowState
>();
let nextNativeApplySequence = 1;

function stateFor(win: AppWindow): TerminalPresentationWindowState {
  const existing = presentationByWindowId.get(win.id);
  if (existing) {
    return existing;
  }
  const created: TerminalPresentationWindowState = {
    overlayActive: false,
  };
  presentationByWindowId.set(win.id, created);
  return created;
}

function emptyDesired(
  state: TerminalPresentationWindowState,
  reason: TerminalPresentationReason
): TerminalPresentationSnapshot {
  return {
    activePanelId: null,
    activePanelKind: "web",
    hasMaximizedGroup: false,
    overlayActive: state.overlayActive,
    reason,
    rendererSequence: state.desired?.rendererSequence ?? 0,
    terminals: state.desired?.terminals ?? [],
  };
}

function effectiveFromDesired(
  win: AppWindow,
  state: TerminalPresentationWindowState,
  desired: TerminalPresentationSnapshot,
  reason: TerminalPresentationReason,
  forcedWindowFocused?: boolean | undefined
): TerminalNativePresentationSnapshot {
  const windowFocused =
    forcedWindowFocused ?? (!win.isDestroyed() && win.isFocused());
  const overlayActive = state.overlayActive || desired.overlayActive;
  const focusCandidate =
    desired.activePanelKind === "terminal" && windowFocused && !overlayActive
      ? desired.activePanelId
      : null;
  let focusedPanelId: string | null = null;
  const terminals = desired.terminals.map((terminal) => {
    const visible = terminal.visible && terminal.frame !== null;
    const focused =
      focusedPanelId === null &&
      visible &&
      terminal.focused &&
      focusCandidate === terminal.panelId;
    if (focused) {
      focusedPanelId = terminal.panelId;
    }
    return {
      ...terminal,
      focused,
      visible,
    };
  });

  return {
    ...desired,
    activePanelId:
      focusedPanelId ??
      (desired.activePanelKind === "web" ? desired.activePanelId : null),
    activePanelKind: focusedPanelId ? "terminal" : "web",
    nativeApplySequence: nextNativeApplySequence++,
    overlayActive,
    reason,
    terminals,
    windowFocused,
  };
}

function scopeNativePresentation(
  win: AppWindow,
  effective: TerminalNativePresentationSnapshot
): TerminalNativePresentationSnapshot {
  return {
    ...effective,
    activePanelId:
      effective.activePanelKind === "terminal" && effective.activePanelId
        ? scopePanelId(win, effective.activePanelId)
        : null,
    terminals: effective.terminals.map((terminal) => ({
      ...terminal,
      panelId: scopePanelId(win, terminal.panelId),
    })),
  };
}

export function applyLatestTerminalPresentation(
  win: AppWindow,
  addon: NativeAddon | null,
  reason: TerminalPresentationReason,
  opts: { windowFocused?: boolean | undefined } = {}
): TerminalNativePresentationSnapshot {
  const state = stateFor(win);
  const desired = state.desired
    ? { ...state.desired, overlayActive: state.overlayActive, reason }
    : emptyDesired(state, reason);
  const effective = effectiveFromDesired(
    win,
    state,
    desired,
    reason,
    opts.windowFocused
  );
  state.effective = effective;
  addon?.applyTerminalPresentation(
    win.getNativeWindowHandle(),
    scopeNativePresentation(win, effective)
  );
  return effective;
}

export function applyRendererTerminalPresentation(
  win: AppWindow,
  addon: NativeAddon | null,
  snapshot: TerminalPresentationSnapshot
): TerminalNativePresentationSnapshot {
  const state = stateFor(win);
  state.desired = snapshot;
  state.overlayActive = snapshot.overlayActive;
  return applyLatestTerminalPresentation(win, addon, snapshot.reason);
}

export function setTerminalOverlayActive(
  win: AppWindow,
  addon: NativeAddon | null,
  active: boolean
): TerminalNativePresentationSnapshot {
  const state = stateFor(win);
  state.overlayActive = active;
  return applyLatestTerminalPresentation(win, addon, "overlay");
}

export function readTerminalPresentationDebug(win: AppWindow): {
  desired?: TerminalPresentationSnapshot | undefined;
  effective?: TerminalNativePresentationSnapshot | undefined;
} {
  const state = presentationByWindowId.get(win.id);
  return {
    desired: state?.desired,
    effective: state?.effective,
  };
}

export function clearTerminalPresentationWindow(win: AppWindow): void {
  presentationByWindowId.delete(win.id);
}
