import { beforeEach, describe, expect, it, vi } from "vitest";

describe("terminal native debug IPC", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function setupHarness() {
    const invokeHandlers = new Map<string, (...args: unknown[]) => unknown>();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const fakeAddon = {
      applyTerminalWindowState: vi.fn(() => ({ status: "applied" })),
      applyTerminalTheme: vi.fn(),
      closeAllTerminals: vi.fn(),
      closeTerminal: vi.fn(),
      createTerminal: vi.fn(() => true),
      debugSnapshot: vi.fn(() =>
        JSON.stringify({
          surfaces: [
            {
              alpha: 1,
              browserWindowId: 7,
              cursorSuppressed: false,
              drawPending: true,
              drawSequence: 12,
              frame: { height: 240, width: 320, x: 10, y: 20 },
              ghosttyRenderReadySequence: 14,
              hasRouterTarget: true,
              hostKeyboardActive: true,
              hostRefreshRequestSequence: 9,
              isFirstResponder: true,
              isHidden: false,
              isSurfaceFocused: false,
              lastDrawUptime: 120.5,
              lastDrawnGhosttyRenderReadySequence: 14,
              lastRenderReadyUptime: 120.4,
              panelId: "7::terminal-1",
              refreshPending: false,
              surfaceGeneration: 3,
              targetRect: { height: 230, width: 310, x: 15, y: 25 },
            },
          ],
          window: {
            activeTerminalPanelId: "7::terminal-1",
            appTickCount: 20,
            inputRoutingStaleDiscardCount: 2,
            keyboardFocusTarget: {
              kind: "terminal",
              panelId: "7::terminal-1",
            },
            lastAppTickUptime: 120.3,
            terminalTargetCount: 1,
            webOverlayRectCount: 0,
          },
        })
      ),
      detachWindow: vi.fn(),
      reconcileTerminals: vi.fn(),
      setKeyboardForwardCallback: vi.fn(),
      setModifierForwardCallback: vi.fn(),
      setMouseForwardCallback: vi.fn(),
      setPwdForwardCallback: vi.fn(),
      setTerminalConfig: vi.fn(),
      setTerminalFocusRequestCallback: vi.fn(),
      setTerminalFont: vi.fn(),
      setTitleForwardCallback: vi.fn(),
      setOpenUrlForwardCallback: vi.fn(),
      setupWindow: vi.fn(() => true),
    };
    const win = {
      focus: vi.fn(),
      getNativeWindowHandle: () => Buffer.from("window"),
      id: 7,
      isDestroyed: () => false,
      isFocused: () => true,
      isMinimized: () => false,
      restore: vi.fn(),
      webContents: {
        focus: vi.fn(),
        isDestroyed: () => false,
        send: vi.fn(),
      },
    };
    const fakeIpcMain = {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          invokeHandlers.set(channel, handler);
        }
      ),
      on: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    };

    vi.doMock("electron", () => ({
      app: { getPath: vi.fn((k: string) => `/tmp/pier-test-${k}`) },
    }));
    vi.doMock("@main/state/terminal-session-state.ts", () => ({
      clearTerminalPanelAgent: vi.fn(async () => undefined),
      ensureTerminalPanelSession: vi.fn(async () => undefined),
      flushTerminalSessionState: vi.fn(async () => undefined),
      patchTerminalPanelAgentStatus: vi.fn(async () => false),
      patchTerminalPanelTab: vi.fn(async () => undefined),
      patchTerminalPanelTaskStatus: vi.fn(async () => undefined),
      readTerminalPanelSession: vi.fn(async () => null),
      removeTerminalPanelSession: vi.fn(async () => undefined),
      retainTerminalPanelSessions: vi.fn(async () => undefined),
      updateTerminalPanelAgent: vi.fn(async () => undefined),
      updateTerminalPanelAgentResume: vi.fn(async () => true),
      updateTerminalPanelContext: vi.fn(async () => undefined),
      updateTerminalPanelTab: vi.fn(async () => undefined),
      updateTerminalPanelTask: vi.fn(async () => undefined),
      updateTerminalPanelTitle: vi.fn(async () => undefined),
    }));
    vi.doMock("@main/windows/window-identity.ts", () => ({
      findAppWindowByElectronId: vi.fn((id: number) =>
        id === win.id ? win : null
      ),
      findAppWindowByWebContents: vi.fn(() => win),
      findInternalWindowId: vi.fn(() => "main"),
      findWindowContext: vi.fn(() => ({
        electronWindowId: String(win.id),
        mode: "restore" as const,
        recordId: "main",
        windowId: "main",
      })),
    }));

    const { registerTerminalIpc } = await import("@main/ipc/terminal.ts");
    registerTerminalIpc(fakeIpcMain as never, {
      loadNativeAddon: () => ({ addon: fakeAddon as never, error: null }),
    });

    return { fakeAddon, handlers, invokeHandlers, win };
  }

  it("returns native surfaces with raw panel ids and recent route events", async () => {
    const { fakeAddon, handlers, invokeHandlers, win } = await setupHarness();
    await invokeHandlers.get("pier:terminal:create")?.(
      { sender: win.webContents },
      {
        font: { family: "Menlo", size: 13 },
        frame: { height: 240, width: 320, x: 10, y: 20 },
        panelId: "terminal-1",
      }
    );
    handlers.get("pier:terminal:apply-host-snapshot")?.(
      { sender: win.webContents },
      {
        activePanelId: "terminal-1",
        activeTerminalPanelId: "terminal-1",
        basePanel: { kind: "terminal", panelId: "terminal-1" },
        focusDisabledPanelIds: [],
        hasMaximizedGroup: false,
        reason: "dockview-active-panel",
        rendererSequence: 1,
        terminals: [
          {
            frame: { height: 240, width: 320, x: 10, y: 20 },
            panelId: "terminal-1",
            visible: true,
          },
        ],
        webOverlayRects: [],
        webRequestCount: 0,
      }
    );
    const focusForward =
      fakeAddon.setTerminalFocusRequestCallback.mock.calls[0]?.[0];
    focusForward?.(win.id, "7::terminal-1");

    const snapshot = await invokeHandlers.get("pier:terminal:debug-snapshot")?.(
      { sender: win.webContents }
    );

    expect(snapshot).toMatchObject({
      native: {
        surfaces: [
          {
            cursorSuppressed: false,
            drawPending: true,
            drawSequence: 12,
            ghosttyRenderReadySequence: 14,
            hostKeyboardActive: true,
            hostRefreshRequestSequence: 9,
            isSurfaceFocused: false,
            lastDrawUptime: 120.5,
            lastDrawnGhosttyRenderReadySequence: 14,
            lastRenderReadyUptime: 120.4,
            nativePanelId: "7::terminal-1",
            panelId: "terminal-1",
            refreshPending: false,
            surfaceGeneration: 3,
          },
        ],
        window: {
          activeTerminalPanelId: "terminal-1",
          appTickCount: 20,
          keyboardFocusTarget: {
            kind: "terminal",
            panelId: "terminal-1",
          },
          lastAppTickUptime: 120.3,
          nativeActiveTerminalPanelId: "7::terminal-1",
        },
      },
    });
    expect(snapshot).toHaveProperty("events");
    expect(
      (snapshot as { events: Array<{ action: string; route: string }> }).events
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "apply-host-snapshot",
          route: "renderer->main->native",
        }),
        expect.objectContaining({
          action: "focus-request",
          panelId: "terminal-1",
          route: "native->main->renderer",
        }),
      ])
    );
  });

  it("keeps missing render diagnostics undefined and drops invalid values", async () => {
    const { fakeAddon, invokeHandlers, win } = await setupHarness();

    fakeAddon.debugSnapshot.mockReturnValue(
      JSON.stringify({
        surfaces: [
          {
            alpha: 1,
            browserWindowId: 7,
            drawPending: "yes",
            drawSequence: -1,
            frame: { height: 240, width: 320, x: 10, y: 20 },
            ghosttyRenderReadySequence: null,
            hasRouterTarget: true,
            isFirstResponder: false,
            isHidden: false,
            isOffscreen: false,
            lastDrawUptime: "now",
            panelId: "7::terminal-1",
          },
        ],
        window: {
          activeTerminalPanelId: null,
          appTickCount: -2,
          keyboardFocusTarget: { kind: "web" },
          lastAppTickUptime: "later",
          terminalTargetCount: 1,
          webOverlayRectCount: 0,
        },
      })
    );

    const snapshot = (await invokeHandlers.get(
      "pier:terminal:debug-snapshot"
    )?.({ sender: win.webContents })) as {
      native: {
        surfaces: Record<string, unknown>[];
        window: Record<string, unknown>;
      };
    };

    expect(snapshot.native.surfaces[0]).toMatchObject({
      drawPending: undefined,
      drawSequence: undefined,
      ghosttyRenderReadySequence: undefined,
      lastDrawUptime: undefined,
    });
    expect(snapshot.native.window).toMatchObject({
      appTickCount: undefined,
      lastAppTickUptime: undefined,
    });
  });

  it("normalizes native recentRouterDecisions: demangles panel-id fields, preserves seq, tallies drops for unknown-kind / non-object entries", async () => {
    const { fakeAddon, invokeHandlers, win } = await setupHarness();

    fakeAddon.debugSnapshot.mockReturnValue(
      JSON.stringify({
        surfaces: [],
        window: {
          activeTerminalPanelId: null,
          keyboardFocusTarget: { kind: "web" },
          recentRouterDecisions: [
            {
              at: 1_700_000_000.5,
              kind: "hit-test",
              payload: {
                decision: "terminal",
                matchedPanelId: "7::terminal-1",
                targetsCount: 2,
                webOverlayCount: 1,
                x: 123.5,
                y: 456,
              },
              seq: 10,
            },
            {
              at: 1_700_000_001,
              kind: "key-down",
              payload: {
                acceptsTerminalKeyboard: true,
                activeTerminalPanelId: "7::terminal-1",
                charsLen: 1,
                decision: "terminal-passthrough",
                mods: 0,
              },
              seq: 11,
            },
            {
              at: 1_700_000_002,
              kind: "unknown-kind",
              payload: {},
              seq: 12,
            },
            "not-an-object",
          ],
          routerDecisionsDroppedCount: 0,
          terminalTargetCount: 2,
          webOverlayRectCount: 1,
        },
      })
    );

    const snapshot = (await invokeHandlers.get(
      "pier:terminal:debug-snapshot"
    )?.({ sender: win.webContents })) as {
      native: {
        window: {
          recentRouterDecisions?: Array<{
            at: number;
            kind: string;
            payload: Record<string, unknown>;
            seq: number;
          }>;
          routerDecisionsDroppedCount?: number;
        };
      };
    };

    expect(snapshot.native.window.recentRouterDecisions).toEqual([
      {
        at: 1_700_000_000.5,
        kind: "hit-test",
        payload: {
          decision: "terminal",
          matchedPanelId: "terminal-1",
          targetsCount: 2,
          webOverlayCount: 1,
          x: 123.5,
          y: 456,
        },
        seq: 10,
      },
      {
        at: 1_700_000_001,
        kind: "key-down",
        payload: {
          acceptsTerminalKeyboard: true,
          activeTerminalPanelId: "terminal-1",
          charsLen: 1,
          decision: "terminal-passthrough",
          mods: 0,
        },
        seq: 11,
      },
    ]);
    expect(snapshot.native.window.routerDecisionsDroppedCount).toBe(2);
  });

  it("surfaces the native error banner when the swift snapshot is a serialization-failure fallback", async () => {
    const { fakeAddon, invokeHandlers, win } = await setupHarness();

    fakeAddon.debugSnapshot.mockReturnValue(
      JSON.stringify({
        error: "native snapshot json serialization failed",
      })
    );

    const snapshot = (await invokeHandlers.get(
      "pier:terminal:debug-snapshot"
    )?.({ sender: win.webContents })) as {
      native: { error?: string };
    };

    expect(snapshot.native.error).toBe(
      "native snapshot json serialization failed"
    );
  });

  it("surfaces an error rather than a silent healthy snapshot when the native payload lacks window/surfaces", async () => {
    const { fakeAddon, invokeHandlers, win } = await setupHarness();

    fakeAddon.debugSnapshot.mockReturnValue("{}");

    const snapshot = (await invokeHandlers.get(
      "pier:terminal:debug-snapshot"
    )?.({ sender: win.webContents })) as {
      native: { error?: string };
    };

    expect(snapshot.native.error).toBe(
      "native debug snapshot payload missing window/surfaces"
    );
  });
});
