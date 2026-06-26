import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/panel-kits/terminal/terminal-layout-coordinator.ts", () => ({
  hasRegisteredTerminalAnchor: vi.fn(
    (panelId: string) => panelId === "terminal-1"
  ),
  readRegisteredTerminalAnchorFrame: vi.fn((panelId: string) =>
    panelId === "terminal-1" ? { height: 240, width: 320, x: 10, y: 20 } : null
  ),
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

describe("terminal debug store", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          debugSnapshot: vi.fn(async () => ({
            events: [],
            native: {
              surfaces: [],
              window: {
                activePanelKind: "terminal",
                activeTerminalPanelId: "terminal-1",
                inTerminalMode: true,
                nativeActiveTerminalPanelId: "1::terminal-1",
                overlayActive: false,
              },
            },
          })),
        },
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "pier");
    vi.clearAllMocks();
  });

  it("adds renderer panels and native-missing diagnostics to debug snapshots", async () => {
    const { useWorkspaceStore } = await import("@/stores/workspace.store.ts");
    const { useTerminalDebugStore } = await import(
      "@/stores/terminal-debug.store.ts"
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

    await useTerminalDebugStore.getState().refresh();

    const snapshot = useTerminalDebugStore.getState().snapshot as {
      issues?: Array<{ code: string; panelId?: string }>;
      renderer?: {
        viewportFrame?: { height: number; width: number; x: number; y: number };
        panels: Array<{
          anchorFrame: {
            height: number;
            width: number;
            x: number;
            y: number;
          } | null;
          dockviewVisible: boolean;
          hasAnchor: boolean;
          panelId: string;
          terminalLifecycle?: { nativeTerminalReady: boolean; phase: string };
        }>;
      };
    } | null;
    expect(snapshot?.renderer?.viewportFrame).toEqual(
      expect.objectContaining({
        height: window.innerHeight,
        width: window.innerWidth,
        x: 0,
        y: 0,
      })
    );
    expect(snapshot?.renderer?.panels).toContainEqual(
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
    expect(snapshot?.issues).toContainEqual(
      expect.objectContaining({
        code: "native_missing",
        panelId: "terminal-1",
      })
    );
  });
});
