import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/panel-kits/terminal/terminal-layout-coordinator.ts", () => ({
  hasRegisteredTerminalAnchor: vi.fn(
    (panelId: string) => panelId === "terminal-1"
  ),
  readRegisteredTerminalAnchorFrame: vi.fn((panelId: string) =>
    panelId === "terminal-1" ? { height: 240, width: 320, x: 10, y: 20 } : null
  ),
  readTerminalViewportFrame: vi.fn(() => ({
    height: window.innerHeight,
    width: window.innerWidth,
    x: 0,
    y: 0,
  })),
}));

function terminalPanel(id: string) {
  return {
    api: {
      isActive: true,
      isVisible: true,
    },
    id,
    title: "Terminal",
    view: { contentComponent: "terminal" },
  };
}

describe("terminal debug renderer snapshot", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("adds renderer panels and native-missing diagnostics to debug snapshots", async () => {
    const { useWorkspaceStore } = await import("@/stores/workspace.store.ts");
    const { buildRendererDebugSnapshot } = await import(
      "@/lib/terminal-debug/renderer-snapshot.ts"
    );
    const { buildTerminalDebugIssues } = await import(
      "@shared/terminal-debug-diagnostics.ts"
    );
    const { updateTerminalPanelLifecycleDebug } = await import(
      "@/panel-kits/terminal/terminal-lifecycle-debug.ts"
    );
    const panel = terminalPanel("terminal-1");
    updateTerminalPanelLifecycleDebug("terminal-1", {
      createAttemptCount: 1,
      createPending: false,
      didCreateNativeTerminal: true,
      error: null,
      hasRenderableAnchor: true,
      nativeTerminalReady: true,
      phase: "ready",
      placeholderVisible: false,
    });
    useWorkspaceStore.getState().setApi({
      activePanel: panel,
      hasMaximizedGroup: vi.fn(() => false),
      panels: [panel],
    } as never);

    const renderer = buildRendererDebugSnapshot();
    const issues = buildTerminalDebugIssues(renderer, {
      surfaces: [],
      window: {
        activeTerminalPanelId: "terminal-1",
        keyboardFocusTarget: { kind: "terminal", panelId: "terminal-1" },
        nativeActiveTerminalPanelId: "1::terminal-1",
        terminalTargetCount: 0,
        webOverlayRectCount: 0,
      },
    });

    expect(renderer.viewportFrame).toEqual(
      expect.objectContaining({
        height: window.innerHeight,
        width: window.innerWidth,
        x: 0,
        y: 0,
      })
    );
    expect(renderer.panels).toContainEqual(
      expect.objectContaining({
        anchorFrame: { height: 240, width: 320, x: 10, y: 20 },
        dockviewVisible: true,
        hasAnchor: true,
        panelId: "terminal-1",
        terminalLifecycle: expect.objectContaining({
          nativeTerminalReady: true,
          phase: "ready",
        }),
      })
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "native_missing",
        panelId: "terminal-1",
      })
    );
  });
});
