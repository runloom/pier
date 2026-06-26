import { buildTerminalDebugIssues } from "@shared/terminal-debug-diagnostics.ts";
import { describe, expect, it } from "vitest";

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
          activePanelKind: "terminal",
          activeTerminalPanelId: "terminal-1",
          inTerminalMode: true,
          nativeActiveTerminalPanelId: "1::terminal-1",
          overlayActive: false,
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
          activePanelKind: "terminal",
          activeTerminalPanelId: "terminal-1",
          inTerminalMode: true,
          nativeActiveTerminalPanelId: "1::terminal-1",
          overlayActive: false,
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
});
