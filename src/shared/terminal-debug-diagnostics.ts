import type {
  TerminalFrame,
  TerminalInputRoutingSnapshot,
  TerminalPresentationEntry,
  TerminalPresentationSnapshot,
} from "./contracts/terminal.ts";
import type {
  TerminalDebugInputRoutingSnapshot,
  TerminalDebugIssue,
  TerminalDebugNativeSnapshot,
  TerminalDebugPresentationSnapshot,
  TerminalDebugRendererSnapshot,
} from "./contracts/terminal-debug.ts";
import {
  computeEffectiveKeyboardTarget,
  sameKeyboardFocusTarget,
} from "./terminal-keyboard-target.ts";

function frameDelta(a: TerminalFrame, b: TerminalFrame): number {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.width - b.width),
    Math.abs(a.height - b.height)
  );
}
function shouldRenderPanel(
  renderer: TerminalDebugRendererSnapshot,
  panel: TerminalDebugRendererSnapshot["panels"][number]
): boolean {
  return (
    panel.component === "terminal" &&
    panel.anchorFrame !== null &&
    (!renderer.hasMaximizedGroup || panel.isActivePanel)
  );
}
function buildRendererPanelLifecycleIssues(
  panel: TerminalDebugRendererSnapshot["panels"][number],
  nativeSurface: TerminalDebugNativeSnapshot["surfaces"][number] | undefined
): TerminalDebugIssue[] {
  const lifecycle = panel.terminalLifecycle;
  if (!lifecycle) {
    return [
      {
        code: "renderer_terminal_lifecycle_missing",
        message: "renderer terminal panel has no React lifecycle debug state",
        panelId: panel.panelId,
        severity: "warning",
      },
    ];
  }
  if (
    lifecycle.placeholderVisible &&
    nativeSurface &&
    isNativeVisible(nativeSurface)
  ) {
    return [
      {
        code: "renderer_terminal_placeholder_visible",
        message:
          "renderer placeholder is still visible while native surface is visible",
        panelId: panel.panelId,
        severity: "error",
      },
    ];
  }
  if (lifecycle.createPending && !nativeSurface) {
    return [
      {
        code: "renderer_terminal_create_pending",
        message:
          "renderer terminal create is pending and native surface is not present yet",
        panelId: panel.panelId,
        severity: "warning",
      },
    ];
  }
  return [];
}
function buildRendererPanelNativeIssues(
  renderer: TerminalDebugRendererSnapshot,
  nativeByPanelId: Map<string, TerminalDebugNativeSnapshot["surfaces"][number]>,
  panel: TerminalDebugRendererSnapshot["panels"][number]
): TerminalDebugIssue[] {
  if (!shouldRenderPanel(renderer, panel)) {
    return [];
  }
  const issues: TerminalDebugIssue[] = [];
  const nativeSurface = nativeByPanelId.get(panel.panelId);
  issues.push(...buildRendererPanelLifecycleIssues(panel, nativeSurface));
  if (!nativeSurface) {
    issues.push({
      code: "native_missing",
      message:
        "renderer terminal anchor is visible but native surface is missing",
      panelId: panel.panelId,
      severity: "error",
    });
    return issues;
  }
  if (
    nativeSurface.isHidden ||
    nativeSurface.isOffscreen ||
    nativeSurface.alpha <= 0
  ) {
    issues.push({
      code: "native_hidden_while_anchor_visible",
      message: "native surface is hidden while renderer anchor is visible",
      panelId: panel.panelId,
      severity: "error",
    });
  }
  const comparableNativeFrame =
    nativeSurface.viewportFrame ??
    nativeSurface.targetRect ??
    nativeSurface.frame;
  if (
    panel.anchorFrame &&
    frameDelta(panel.anchorFrame, comparableNativeFrame) > 2
  ) {
    issues.push({
      code: "frame_mismatch",
      message: "renderer anchor frame and native surface frame differ",
      panelId: panel.panelId,
      severity: "warning",
    });
  }
  return issues;
}

export function buildTerminalDebugIssues(
  renderer: TerminalDebugRendererSnapshot,
  native: TerminalDebugNativeSnapshot,
  presentation?: TerminalDebugPresentationSnapshot | undefined,
  inputRouting?: TerminalDebugInputRoutingSnapshot | undefined
): TerminalDebugIssue[] {
  const issues: TerminalDebugIssue[] = [];
  const panelCounts = new Map<string, number>();
  for (const panel of renderer.panels) {
    panelCounts.set(panel.panelId, (panelCounts.get(panel.panelId) ?? 0) + 1);
  }
  for (const [panelId, count] of panelCounts) {
    if (count > 1) {
      issues.push({
        code: "duplicate_renderer_panel",
        message: `renderer has ${count} panels with the same id`,
        panelId,
        severity: "error",
      });
    }
  }

  const nativeByPanelId = new Map(
    native.surfaces.map((surface) => [surface.panelId, surface])
  );
  const expectedPresentation =
    presentation?.effective ??
    presentation?.desired ??
    renderer.desiredPresentation;
  if (expectedPresentation) {
    issues.push(
      ...buildTerminalPresentationIssues(expectedPresentation, native)
    );
  }
  const expectedInputRouting =
    inputRouting?.effective ??
    inputRouting?.desired ??
    renderer.desiredInputRouting;
  if (expectedInputRouting) {
    issues.push(
      ...buildTerminalInputRoutingIssues(expectedInputRouting, native)
    );
  }
  const rendererTerminalIds = new Set(
    renderer.panels
      .filter((panel) => panel.component === "terminal")
      .map((panel) => panel.panelId)
  );

  for (const panel of renderer.panels) {
    issues.push(
      ...buildRendererPanelNativeIssues(renderer, nativeByPanelId, panel)
    );
  }

  for (const surface of native.surfaces) {
    if (!rendererTerminalIds.has(surface.panelId)) {
      issues.push({
        code: "orphan_native_surface",
        message: "native surface has no matching renderer terminal panel",
        panelId: surface.panelId,
        severity: "warning",
      });
    }
  }

  return issues;
}

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

function buildTerminalInputRoutingIssues(
  expected: TerminalInputRoutingSnapshot,
  native: TerminalDebugNativeSnapshot
): TerminalDebugIssue[] {
  const issues: TerminalDebugIssue[] = [];
  if (
    native.window.lastAppliedInputRoutingSequence !== undefined &&
    native.window.lastAppliedInputRoutingSequence < expected.rendererSequence
  ) {
    issues.push({
      code: "input_routing_stale",
      message:
        "native last applied input routing sequence is behind desired input routing",
      severity: "warning",
    });
  }
  const expectedEffective = computeEffectiveKeyboardTarget(
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
  const windowFocused =
    "windowFocused" in expected ? expected.windowFocused !== false : true;
  const surfaceState = collectInputRoutingSurfaceState(native);
  if (expectedEffective.kind === "web") {
    return issues.concat(buildWebKeyboardTargetIssues(surfaceState));
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
  state: InputRoutingSurfaceState
): TerminalDebugIssue[] {
  const issues: TerminalDebugIssue[] = [];
  if (state.focusedSurfaces.length > 0) {
    issues.push({
      code: "input_routing_keyboard_first_responder_mismatch",
      message: "keyboard target is Web but a terminal is first responder",
      panelId: state.focusedSurfaces[0]?.panelId,
      severity: "error",
    });
  }
  if (state.surfaceFocusedSurfaces.length > 0) {
    issues.push({
      code: "input_routing_terminal_surface_focus_mismatch",
      message: "keyboard target is Web but a terminal surface is focused",
      panelId: state.surfaceFocusedSurfaces[0]?.panelId,
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

function isNativeVisible(
  surface: TerminalDebugNativeSnapshot["surfaces"][number]
): boolean {
  return !(surface.isHidden || surface.isOffscreen) && surface.alpha > 0;
}

function buildTerminalPresentationIssues(
  expected: TerminalPresentationSnapshot,
  native: TerminalDebugNativeSnapshot
): TerminalDebugIssue[] {
  const issues: TerminalDebugIssue[] = [];
  const nativeByPanelId = new Map(
    native.surfaces.map((surface) => [surface.panelId, surface])
  );
  if (
    native.window.lastAppliedRendererSequence !== undefined &&
    native.window.lastAppliedRendererSequence < expected.rendererSequence
  ) {
    issues.push({
      code: "presentation_stale",
      message:
        "native last applied renderer sequence is behind desired presentation",
      severity: "warning",
    });
  }

  for (const terminal of expected.terminals) {
    const nativeSurface = nativeByPanelId.get(terminal.panelId);
    issues.push(
      ...buildTerminalPresentationPanelIssues(terminal, nativeSurface)
    );
  }
  return issues;
}

function buildTerminalPresentationPanelIssues(
  expected: TerminalPresentationEntry,
  nativeSurface: TerminalDebugNativeSnapshot["surfaces"][number] | undefined
): TerminalDebugIssue[] {
  if (!nativeSurface) {
    return expected.visible
      ? [
          {
            code: "desired_visible_native_hidden",
            message:
              "desired presentation marks terminal visible but native surface is missing",
            panelId: expected.panelId,
            severity: "error",
          },
        ]
      : [];
  }
  const issues: TerminalDebugIssue[] = [];
  const nativeVisible = isNativeVisible(nativeSurface);
  if (expected.visible && !nativeVisible) {
    issues.push({
      code: "desired_visible_native_hidden",
      message:
        "desired presentation marks terminal visible but native surface is hidden",
      panelId: expected.panelId,
      severity: "error",
    });
  }
  if (!expected.visible && nativeVisible) {
    issues.push({
      code: "desired_hidden_native_visible",
      message:
        "desired presentation marks terminal hidden but native surface is visible",
      panelId: expected.panelId,
      severity: "error",
    });
  }
  const nativeFrame =
    nativeSurface.viewportFrame ??
    nativeSurface.targetRect ??
    nativeSurface.frame;
  if (
    expected.frame &&
    expected.visible &&
    frameDelta(expected.frame, nativeFrame) > 2
  ) {
    issues.push({
      code: "desired_frame_native_mismatch",
      message: "desired presentation frame and native surface frame differ",
      panelId: expected.panelId,
      severity: "warning",
    });
  }
  return issues;
}
