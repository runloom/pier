import type {
  TerminalDebugIssue,
  TerminalDebugNativeSnapshot,
  TerminalDebugPresentationSnapshot,
  TerminalDebugRendererSnapshot,
  TerminalFrame,
  TerminalPresentationEntry,
  TerminalPresentationSnapshot,
} from "./contracts/terminal.ts";

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
  presentation?: TerminalDebugPresentationSnapshot | undefined
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

  const focusedExpected = new Set(
    expected.terminals
      .filter((terminal) => terminal.focused)
      .map((terminal) => terminal.panelId)
  );
  for (const terminal of expected.terminals) {
    const nativeSurface = nativeByPanelId.get(terminal.panelId);
    issues.push(
      ...buildTerminalPresentationPanelIssues(terminal, nativeSurface)
    );
    if (
      nativeSurface &&
      focusedExpected.has(terminal.panelId) !== nativeSurface.isFirstResponder
    ) {
      issues.push({
        code: "desired_focus_native_first_responder_mismatch",
        message: "desired terminal focus does not match native first responder",
        panelId: terminal.panelId,
        severity: "error",
      });
    }
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
