import type {
  TerminalHostSnapshot,
  TerminalNativeWindowState,
} from "./contracts/terminal.ts";
import type {
  TerminalDebugIssue,
  TerminalDebugNativeSnapshot,
} from "./contracts/terminal-debug.ts";
import {
  computeEffectiveKeyboardTarget,
  sameKeyboardFocusTarget,
} from "./terminal-keyboard-target.ts";

type NativeSurface = TerminalDebugNativeSnapshot["surfaces"][number];

interface InputRoutingSurfaceState {
  cursorActiveSurfaces: NativeSurface[];
  focusedSurfaces: NativeSurface[];
  hostKeyboardActiveSurfaces: NativeSurface[];
  surfaceFocusedSurfaces: NativeSurface[];
}

function collectInputRoutingSurfaceState(
  native: TerminalDebugNativeSnapshot
): InputRoutingSurfaceState {
  return {
    cursorActiveSurfaces: native.surfaces.filter(
      (surface) => surface.cursorSuppressed === false
    ),
    focusedSurfaces: native.surfaces.filter(
      (surface) => surface.isFirstResponder
    ),
    hostKeyboardActiveSurfaces: native.surfaces.filter(
      (surface) => surface.hostKeyboardActive === true
    ),
    surfaceFocusedSurfaces: native.surfaces.filter(
      (surface) => surface.isSurfaceFocused === true
    ),
  };
}

export function buildTerminalInputRoutingIssues(
  expected: TerminalHostSnapshot,
  native: TerminalDebugNativeSnapshot,
  effective?: TerminalNativeWindowState | null
): TerminalDebugIssue[] {
  const issues: TerminalDebugIssue[] = [];
  if (
    native.window.lastAppliedRendererSequence !== undefined &&
    native.window.lastAppliedRendererSequence < expected.rendererSequence
  ) {
    issues.push({
      code: "input_routing_stale",
      message:
        "native last applied input routing sequence is behind desired input routing",
      severity: "warning",
    });
  }
  const expectedEffective =
    effective?.keyboardTarget ??
    computeEffectiveKeyboardTarget(
      expected.basePanel,
      expected.webRequestCount
    );
  if (
    !sameKeyboardFocusTarget(
      expectedEffective,
      native.window.keyboardFocusTarget
    )
  ) {
    issues.push({
      code: "input_routing_keyboard_target_mismatch",
      message: "desired keyboard focus target does not match native router",
      ...(expectedEffective.kind === "terminal"
        ? { panelId: expectedEffective.panelId }
        : {}),
      severity: "error",
    });
  }
  if (native.window.webOverlayRectCount !== expected.webOverlayRects.length) {
    issues.push({
      code: "input_routing_overlay_rect_count_mismatch",
      message: "desired Web overlay rect count does not match native router",
      severity: "warning",
    });
  }
  const windowFocused = effective?.windowFocused ?? true;
  const surfaceState = collectInputRoutingSurfaceState(native);
  if (expectedEffective.kind === "web") {
    // Composer focusDisabled may pin surface focus; diagnostics allow that.
    return issues.concat(
      buildWebKeyboardTargetIssues(surfaceState, expected.focusDisabledPanelIds)
    );
  }
  if (!windowFocused) {
    return issues.concat(buildBlurredWindowInputRoutingIssues(surfaceState));
  }
  const expectedPanelId = expectedEffective.panelId;
  const expectedSurface = native.surfaces.find(
    (surface) => surface.panelId === expectedPanelId
  );
  if (!expectedSurface) {
    issues.push({
      code: "input_routing_terminal_target_missing",
      message: "keyboard target terminal has no native surface",
      panelId: expectedPanelId,
      severity: "error",
    });
    return issues;
  }
  return issues.concat(
    buildTerminalKeyboardTargetIssues(expectedPanelId, expectedSurface, native)
  );
}

function buildWebKeyboardTargetIssues(
  state: InputRoutingSurfaceState,
  focusDisabledPanelIds: readonly string[] = []
): TerminalDebugIssue[] {
  const pinned = new Set(focusDisabledPanelIds);
  const issues: TerminalDebugIssue[] = [];
  // First responder should never stay on a terminal while keyboard is Web
  // (composer pins surface focus without holding AppKit FR).
  if (state.focusedSurfaces.length > 0) {
    issues.push({
      code: "input_routing_keyboard_first_responder_mismatch",
      message: "keyboard target is Web but a terminal is first responder",
      panelId: state.focusedSurfaces[0]?.panelId,
      severity: "error",
    });
  }
  const unexpectedSurfaceFocus = state.surfaceFocusedSurfaces.filter(
    (surface) => !pinned.has(surface.panelId)
  );
  if (unexpectedSurfaceFocus.length > 0) {
    issues.push({
      code: "input_routing_terminal_surface_focus_mismatch",
      message: "keyboard target is Web but a terminal surface is focused",
      panelId: unexpectedSurfaceFocus[0]?.panelId,
      severity: "error",
    });
  }
  if (state.hostKeyboardActiveSurfaces.length > 0) {
    issues.push({
      code: "input_routing_terminal_cursor_policy_mismatch",
      message:
        "keyboard target is Web but a terminal host keyboard state is active",
      panelId: state.hostKeyboardActiveSurfaces[0]?.panelId,
      severity: "error",
    });
  }
  // Composer pin should suppress painted cursor (only composer caret blinks).
  if (state.cursorActiveSurfaces.length > 0) {
    issues.push({
      code: "input_routing_terminal_cursor_policy_mismatch",
      message: "keyboard target is Web but a terminal cursor is not suppressed",
      panelId: state.cursorActiveSurfaces[0]?.panelId,
      severity: "error",
    });
  }
  return issues;
}

function buildBlurredWindowInputRoutingIssues(
  state: InputRoutingSurfaceState
): TerminalDebugIssue[] {
  const surface =
    state.hostKeyboardActiveSurfaces[0] ?? state.cursorActiveSurfaces[0];
  if (!surface) {
    return [];
  }
  return [
    {
      code: "input_routing_terminal_cursor_policy_mismatch",
      message: "window is blurred but a terminal cursor policy is active",
      panelId: surface.panelId,
      severity: "error",
    },
  ];
}

function buildTerminalKeyboardTargetIssues(
  expectedPanelId: string,
  expectedSurface: NativeSurface,
  native: TerminalDebugNativeSnapshot
): TerminalDebugIssue[] {
  const issues: TerminalDebugIssue[] = [];
  if (expectedSurface && !expectedSurface.isFirstResponder) {
    issues.push({
      code: "input_routing_keyboard_first_responder_mismatch",
      message: "keyboard target terminal is not native first responder",
      panelId: expectedPanelId,
      severity: "error",
    });
  }
  if (expectedSurface?.isSurfaceFocused === false) {
    issues.push({
      code: "input_routing_terminal_surface_focus_mismatch",
      message: "keyboard target terminal surface is not focused",
      panelId: expectedPanelId,
      severity: "error",
    });
  }
  if (expectedSurface.hostKeyboardActive !== true) {
    issues.push({
      code: "input_routing_terminal_cursor_policy_mismatch",
      message: "keyboard target terminal host keyboard state is not active",
      panelId: expectedPanelId,
      severity: "error",
    });
  }
  if (expectedSurface.cursorSuppressed !== false) {
    issues.push({
      code: "input_routing_terminal_cursor_policy_mismatch",
      message: "keyboard target terminal cursor is suppressed",
      panelId: expectedPanelId,
      severity: "error",
    });
  }
  const wrongHostSurface = native.surfaces.find(
    (surface) =>
      surface.panelId !== expectedPanelId &&
      (surface.hostKeyboardActive === true ||
        surface.cursorSuppressed === false)
  );
  if (wrongHostSurface) {
    issues.push({
      code: "input_routing_terminal_cursor_policy_mismatch",
      message: "non-target terminal has active host keyboard or cursor policy",
      panelId: wrongHostSurface.panelId,
      severity: "error",
    });
  }
  return issues;
}
