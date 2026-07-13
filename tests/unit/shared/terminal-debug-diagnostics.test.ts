import { buildTerminalDebugIssues } from "@shared/terminal-debug-diagnostics.ts";
import { describe, expect, it } from "vitest";

function desiredHostSnapshot(
  basePanel: { kind: "web" } | { kind: "terminal"; panelId: string },
  rendererSequence: number
) {
  const terminalPanelId =
    basePanel.kind === "terminal" ? basePanel.panelId : null;
  return {
    activePanelId: "terminal-1",
    activeTerminalPanelId: terminalPanelId,
    basePanel,
    hasMaximizedGroup: false,
    reason: "input-routing" as const,
    rendererSequence,
    terminals: [
      {
        frame: { height: 93, width: 213, x: 0, y: 72 },
        panelId: "terminal-1",
        visible: true,
      },
    ],
    webOverlayRects: [],
    webRequestCount: 0,
  };
}

function blurredCoordinatorDebug(rendererSequence: number) {
  const desired = desiredHostSnapshot(
    { kind: "terminal", panelId: "terminal-1" },
    rendererSequence
  );
  return {
    desired,
    dirty: false,
    effective: {
      keyboardTarget: { kind: "web" as const },
      nativeApplySequence: 6,
      reason: "window-blur" as const,
      rendererSequence,
      terminals: desired.terminals.map((entry) => ({
        ...entry,
        focused: false,
      })),
      webOverlayRects: [],
      windowFocused: false,
    },
    lastError: null,
    lastSuccessfulNativeApplySequence: 6,
    readyPanelIds: ["terminal-1"],
  };
}

describe("terminal debug diagnostics", () => {
  it("compares renderer anchors with native viewport frames, not AppKit frames", () => {
    const issues = buildTerminalDebugIssues(
      {
        activePanelId: "terminal-1",
        hasMaximizedGroup: false,
        panelCount: 1,
        panels: [
          {
            anchorFrame: { height: 93, width: 213, x: 0, y: 72 },
            component: "terminal",
            dockviewActive: true,
            dockviewVisible: true,
            hasAnchor: true,
            isActivePanel: true,
            panelId: "terminal-1",
          },
        ],
      },
      {
        surfaces: [
          {
            alpha: 1,
            browserWindowId: 1,
            frame: { height: 93, width: 213, x: 0, y: 580 },
            hasRouterTarget: true,
            isFirstResponder: true,
            isHidden: false,
            isOffscreen: false,
            nativePanelId: "1::terminal-1",
            panelId: "terminal-1",
            viewportFrame: { height: 93, width: 213, x: 0, y: 72 },
          },
        ],
        window: {
          activeTerminalPanelId: "terminal-1",
          keyboardFocusTarget: { kind: "terminal", panelId: "terminal-1" },
          nativeActiveTerminalPanelId: "1::terminal-1",
          terminalTargetCount: 1,
          webOverlayRectCount: 0,
        },
      }
    );

    expect(issues).not.toContainEqual(
      expect.objectContaining({ code: "frame_mismatch" })
    );
  });

  it("reports a visible native surface covered by a renderer placeholder", () => {
    const issues = buildTerminalDebugIssues(
      {
        activePanelId: "terminal-1",
        hasMaximizedGroup: false,
        panelCount: 1,
        panels: [
          {
            anchorFrame: { height: 93, width: 213, x: 0, y: 72 },
            component: "terminal",
            dockviewActive: true,
            dockviewVisible: true,
            hasAnchor: true,
            isActivePanel: true,
            panelId: "terminal-1",
            terminalLifecycle: {
              createAttemptCount: 1,
              createPending: false,
              didCreateNativeTerminal: true,
              error: null,
              hasRenderableAnchor: true,
              nativeTerminalReady: false,
              phase: "mounted",
              placeholderVisible: true,
              updatedAt: 12,
            },
          },
        ],
      },
      {
        surfaces: [
          {
            alpha: 1,
            browserWindowId: 1,
            frame: { height: 93, width: 213, x: 0, y: 72 },
            hasRouterTarget: true,
            isFirstResponder: false,
            isHidden: false,
            isOffscreen: false,
            nativePanelId: "1::terminal-1",
            panelId: "terminal-1",
            viewportFrame: { height: 93, width: 213, x: 0, y: 72 },
          },
        ],
        window: {
          activeTerminalPanelId: "terminal-1",
          keyboardFocusTarget: { kind: "terminal", panelId: "terminal-1" },
          nativeActiveTerminalPanelId: "1::terminal-1",
          terminalTargetCount: 1,
          webOverlayRectCount: 0,
        },
      }
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "renderer_terminal_placeholder_visible",
        panelId: "terminal-1",
        severity: "error",
      })
    );
  });

  it("reports a focused terminal surface while keyboard target is Web", () => {
    const issues = buildTerminalDebugIssues(
      {
        activePanelId: "terminal-1",
        desiredHostSnapshot: desiredHostSnapshot({ kind: "web" }, 4),
        hasMaximizedGroup: false,
        panelCount: 1,
        panels: [
          {
            anchorFrame: { height: 93, width: 213, x: 0, y: 72 },
            component: "terminal",
            dockviewActive: true,
            dockviewVisible: true,
            hasAnchor: true,
            isActivePanel: true,
            panelId: "terminal-1",
          },
        ],
      },
      {
        surfaces: [
          {
            alpha: 1,
            browserWindowId: 1,
            frame: { height: 93, width: 213, x: 0, y: 72 },
            hasRouterTarget: true,
            hostKeyboardActive: false,
            isFirstResponder: false,
            isHidden: false,
            isOffscreen: false,
            isSurfaceFocused: true,
            cursorSuppressed: true,
            nativePanelId: "1::terminal-1",
            panelId: "terminal-1",
            viewportFrame: { height: 93, width: 213, x: 0, y: 72 },
          },
        ],
        window: {
          activeTerminalPanelId: null,
          keyboardFocusTarget: { kind: "web" },
          lastAppliedRendererSequence: 4,
          nativeActiveTerminalPanelId: null,
          terminalTargetCount: 1,
          webOverlayRectCount: 0,
        },
      }
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "input_routing_terminal_surface_focus_mismatch",
        panelId: "terminal-1",
        severity: "error",
      })
    );
  });

  it("reports active terminal cursor policy while keyboard target is Web", () => {
    const issues = buildTerminalDebugIssues(
      {
        activePanelId: "terminal-1",
        desiredHostSnapshot: desiredHostSnapshot({ kind: "web" }, 4),
        hasMaximizedGroup: false,
        panelCount: 1,
        panels: [
          {
            anchorFrame: { height: 93, width: 213, x: 0, y: 72 },
            component: "terminal",
            dockviewActive: true,
            dockviewVisible: true,
            hasAnchor: true,
            isActivePanel: true,
            panelId: "terminal-1",
          },
        ],
      },
      {
        surfaces: [
          {
            alpha: 1,
            browserWindowId: 1,
            cursorSuppressed: false,
            frame: { height: 93, width: 213, x: 0, y: 72 },
            hasRouterTarget: true,
            hostKeyboardActive: true,
            isFirstResponder: false,
            isHidden: false,
            isOffscreen: false,
            isSurfaceFocused: false,
            nativePanelId: "1::terminal-1",
            panelId: "terminal-1",
            viewportFrame: { height: 93, width: 213, x: 0, y: 72 },
          },
        ],
        window: {
          activeTerminalPanelId: null,
          keyboardFocusTarget: { kind: "web" },
          lastAppliedRendererSequence: 4,
          nativeActiveTerminalPanelId: null,
          terminalTargetCount: 1,
          webOverlayRectCount: 0,
        },
      }
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "input_routing_terminal_cursor_policy_mismatch",
        panelId: "terminal-1",
        severity: "error",
      })
    );
  });

  it("reports a terminal keyboard target with no native surface", () => {
    const issues = buildTerminalDebugIssues(
      {
        activePanelId: "terminal-1",
        desiredHostSnapshot: desiredHostSnapshot(
          { kind: "terminal", panelId: "terminal-1" },
          4
        ),
        hasMaximizedGroup: false,
        panelCount: 1,
        panels: [
          {
            anchorFrame: { height: 93, width: 213, x: 0, y: 72 },
            component: "terminal",
            dockviewActive: true,
            dockviewVisible: true,
            hasAnchor: true,
            isActivePanel: true,
            panelId: "terminal-1",
          },
        ],
      },
      {
        surfaces: [],
        window: {
          activeTerminalPanelId: "terminal-1",
          keyboardFocusTarget: { kind: "terminal", panelId: "terminal-1" },
          lastAppliedRendererSequence: 4,
          nativeActiveTerminalPanelId: "1::terminal-1",
          terminalTargetCount: 0,
          webOverlayRectCount: 0,
        },
      }
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "input_routing_terminal_target_missing",
        panelId: "terminal-1",
        severity: "error",
      })
    );
  });

  it("does not require terminal first responder while the window is blurred", () => {
    const issues = buildTerminalDebugIssues(
      {
        activePanelId: "terminal-1",
        desiredHostSnapshot: desiredHostSnapshot(
          { kind: "terminal", panelId: "terminal-1" },
          3
        ),
        hasMaximizedGroup: false,
        panelCount: 1,
        panels: [
          {
            anchorFrame: { height: 93, width: 213, x: 0, y: 72 },
            component: "terminal",
            dockviewActive: true,
            dockviewVisible: true,
            hasAnchor: true,
            isActivePanel: true,
            panelId: "terminal-1",
          },
        ],
      },
      {
        surfaces: [
          {
            alpha: 1,
            browserWindowId: 1,
            cursorSuppressed: true,
            frame: { height: 93, width: 213, x: 0, y: 72 },
            hasRouterTarget: true,
            hostKeyboardActive: false,
            isFirstResponder: false,
            isHidden: false,
            isOffscreen: false,
            nativePanelId: "1::terminal-1",
            panelId: "terminal-1",
            viewportFrame: { height: 93, width: 213, x: 0, y: 72 },
          },
        ],
        window: {
          activeTerminalPanelId: "terminal-1",
          keyboardFocusTarget: { kind: "terminal", panelId: "terminal-1" },
          lastAppliedRendererSequence: 3,
          nativeActiveTerminalPanelId: "1::terminal-1",
          terminalTargetCount: 1,
          webOverlayRectCount: 0,
        },
      },
      blurredCoordinatorDebug(3)
    );

    expect(issues).not.toContainEqual(
      expect.objectContaining({
        code: "input_routing_keyboard_first_responder_mismatch",
      })
    );
  });

  it("reports missing active cursor policy for the terminal keyboard target", () => {
    const issues = buildTerminalDebugIssues(
      {
        activePanelId: "terminal-1",
        desiredHostSnapshot: desiredHostSnapshot(
          { kind: "terminal", panelId: "terminal-1" },
          4
        ),
        hasMaximizedGroup: false,
        panelCount: 1,
        panels: [
          {
            anchorFrame: { height: 93, width: 213, x: 0, y: 72 },
            component: "terminal",
            dockviewActive: true,
            dockviewVisible: true,
            hasAnchor: true,
            isActivePanel: true,
            panelId: "terminal-1",
          },
        ],
      },
      {
        surfaces: [
          {
            alpha: 1,
            browserWindowId: 1,
            cursorSuppressed: true,
            frame: { height: 93, width: 213, x: 0, y: 72 },
            hasRouterTarget: true,
            hostKeyboardActive: false,
            isFirstResponder: true,
            isHidden: false,
            isOffscreen: false,
            isSurfaceFocused: true,
            nativePanelId: "1::terminal-1",
            panelId: "terminal-1",
            viewportFrame: { height: 93, width: 213, x: 0, y: 72 },
          },
        ],
        window: {
          activeTerminalPanelId: "terminal-1",
          keyboardFocusTarget: { kind: "terminal", panelId: "terminal-1" },
          lastAppliedRendererSequence: 4,
          nativeActiveTerminalPanelId: "1::terminal-1",
          terminalTargetCount: 1,
          webOverlayRectCount: 0,
        },
      }
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "input_routing_terminal_cursor_policy_mismatch",
        panelId: "terminal-1",
        severity: "error",
      })
    );
  });
});
