import type {
  TerminalDebugInputRoutingSnapshot,
  TerminalDebugPresentationSnapshot,
  TerminalInputRoutingSnapshot,
  TerminalKeyboardFocusTarget,
  TerminalNativeInputRoutingSnapshot,
  TerminalNativePresentationSnapshot,
  TerminalPresentationReason,
  TerminalPresentationSnapshot,
} from "@shared/contracts/terminal.ts";
import { computeEffectiveKeyboardTarget } from "@shared/terminal-keyboard-target.ts";
import type { AppWindow } from "../windows/app-window.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { scopePanelId } from "./terminal-panel-id.ts";

interface TerminalPresentationWindowState {
  desiredInputRouting?: TerminalInputRoutingSnapshot | undefined;
  desiredPresentation?: TerminalPresentationSnapshot | undefined;
  effectiveInputRouting?: TerminalNativeInputRoutingSnapshot | undefined;
  effectivePresentation?: TerminalNativePresentationSnapshot | undefined;
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
  const created: TerminalPresentationWindowState = {};
  presentationByWindowId.set(win.id, created);
  return created;
}

function emptyDesiredPresentation(
  state: TerminalPresentationWindowState,
  reason: TerminalPresentationReason
): TerminalPresentationSnapshot {
  return {
    activePanelId: null,
    activeTerminalPanelId: null,
    hasMaximizedGroup: false,
    reason,
    rendererSequence: state.desiredPresentation?.rendererSequence ?? 0,
    terminals: state.desiredPresentation?.terminals ?? [],
  };
}

function desiredInputRouting(
  state: TerminalPresentationWindowState
): TerminalInputRoutingSnapshot {
  return (
    state.desiredInputRouting ?? {
      basePanel: { kind: "web" },
      rendererSequence: 0,
      webOverlayRects: [],
      webRequestCount: 0,
    }
  );
}

function terminalFocusPanelId(
  inputRouting: TerminalInputRoutingSnapshot,
  windowFocused: boolean
): string | null {
  const effective = computeEffectiveKeyboardTarget(
    inputRouting.basePanel,
    inputRouting.webRequestCount
  );
  if (!windowFocused || effective.kind !== "terminal") {
    return null;
  }
  return effective.panelId;
}

function effectivePresentationFromDesired(
  win: AppWindow,
  desired: TerminalPresentationSnapshot,
  inputRouting: TerminalInputRoutingSnapshot,
  reason: TerminalPresentationReason,
  forcedWindowFocused?: boolean | undefined
): TerminalNativePresentationSnapshot {
  const windowFocused =
    forcedWindowFocused ?? (!win.isDestroyed() && win.isFocused());
  const focusCandidate = terminalFocusPanelId(inputRouting, windowFocused);
  let focusedPanelId: string | null = null;
  const terminals = desired.terminals.map((terminal) => {
    const visible = terminal.visible && terminal.frame !== null;
    const focused =
      focusedPanelId === null && visible && focusCandidate === terminal.panelId;
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
    nativeApplySequence: nextNativeApplySequence++,
    reason,
    terminals,
    windowFocused,
  };
}

function effectiveInputRoutingFromDesired(
  win: AppWindow,
  desired: TerminalInputRoutingSnapshot,
  forcedWindowFocused?: boolean | undefined
): TerminalNativeInputRoutingSnapshot {
  const windowFocused =
    forcedWindowFocused ?? (!win.isDestroyed() && win.isFocused());
  return {
    ...desired,
    nativeApplySequence: nextNativeApplySequence++,
    windowFocused,
  };
}

function scopeBasePanel(
  win: AppWindow,
  target: TerminalKeyboardFocusTarget
): TerminalKeyboardFocusTarget {
  return target.kind === "terminal"
    ? { kind: "terminal", panelId: scopePanelId(win, target.panelId) }
    : target;
}

function scopeNativePresentation(
  win: AppWindow,
  effective: TerminalNativePresentationSnapshot
): TerminalNativePresentationSnapshot {
  return {
    ...effective,
    activePanelId:
      effective.activePanelId === effective.activeTerminalPanelId &&
      effective.activePanelId
        ? scopePanelId(win, effective.activePanelId)
        : effective.activePanelId,
    activeTerminalPanelId: effective.activeTerminalPanelId
      ? scopePanelId(win, effective.activeTerminalPanelId)
      : null,
    terminals: effective.terminals.map((terminal) => ({
      ...terminal,
      panelId: scopePanelId(win, terminal.panelId),
    })),
  };
}

function scopeNativeInputRouting(
  win: AppWindow,
  effective: TerminalNativeInputRoutingSnapshot
): TerminalNativeInputRoutingSnapshot {
  return {
    ...effective,
    basePanel: scopeBasePanel(win, effective.basePanel),
  };
}

export function applyLatestTerminalState(
  win: AppWindow,
  addon: NativeAddon | null,
  reason: TerminalPresentationReason,
  opts: { windowFocused?: boolean | undefined } = {}
): {
  inputRouting: TerminalNativeInputRoutingSnapshot;
  presentation: TerminalNativePresentationSnapshot;
} {
  const state = stateFor(win);
  const presentation = state.desiredPresentation
    ? { ...state.desiredPresentation, reason }
    : emptyDesiredPresentation(state, reason);
  const inputRouting = desiredInputRouting(state);
  const effectivePresentation = effectivePresentationFromDesired(
    win,
    presentation,
    inputRouting,
    reason,
    opts.windowFocused
  );
  const effectiveInputRouting = effectiveInputRoutingFromDesired(
    win,
    inputRouting,
    opts.windowFocused
  );
  state.effectivePresentation = effectivePresentation;
  state.effectiveInputRouting = effectiveInputRouting;
  const handle = win.getNativeWindowHandle();
  addon?.applyTerminalPresentation(
    handle,
    scopeNativePresentation(win, effectivePresentation)
  );
  addon?.applyTerminalInputRouting(
    handle,
    scopeNativeInputRouting(win, effectiveInputRouting)
  );
  return {
    inputRouting: effectiveInputRouting,
    presentation: effectivePresentation,
  };
}

export function applyLatestTerminalPresentation(
  win: AppWindow,
  addon: NativeAddon | null,
  reason: TerminalPresentationReason,
  opts: { windowFocused?: boolean | undefined } = {}
): TerminalNativePresentationSnapshot {
  return applyLatestTerminalState(win, addon, reason, opts).presentation;
}

export function applyRendererTerminalPresentation(
  win: AppWindow,
  addon: NativeAddon | null,
  snapshot: TerminalPresentationSnapshot
): TerminalNativePresentationSnapshot {
  const state = stateFor(win);
  state.desiredPresentation = snapshot;
  return applyLatestTerminalState(win, addon, snapshot.reason).presentation;
}

export function applyRendererTerminalInputRouting(
  win: AppWindow,
  addon: NativeAddon | null,
  snapshot: TerminalInputRoutingSnapshot
): TerminalNativeInputRoutingSnapshot {
  const state = stateFor(win);
  state.desiredInputRouting = snapshot;
  return applyLatestTerminalState(win, addon, "dockview-active-panel")
    .inputRouting;
}

export function readTerminalPresentationDebug(
  win: AppWindow
): TerminalDebugPresentationSnapshot {
  const state = presentationByWindowId.get(win.id);
  return {
    desired: state?.desiredPresentation,
    effective: state?.effectivePresentation,
  };
}

export function readTerminalInputRoutingDebug(
  win: AppWindow
): TerminalDebugInputRoutingSnapshot {
  const state = presentationByWindowId.get(win.id);
  return {
    desired: state?.desiredInputRouting,
    effective: state?.effectiveInputRouting,
  };
}

export function clearTerminalPresentationWindow(win: AppWindow): void {
  clearTerminalPresentationWindowById(win.id);
}

export function clearTerminalPresentationWindowById(windowId: number): void {
  presentationByWindowId.delete(windowId);
}
