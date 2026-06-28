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
      applyTerminalInputRouting: vi.fn(),
      applyTerminalPresentation: vi.fn(),
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
              frame: { height: 240, width: 320, x: 10, y: 20 },
              hasRouterTarget: true,
              hostKeyboardActive: true,
              isFirstResponder: true,
              isHidden: false,
              isSurfaceFocused: false,
              panelId: "7::terminal-1",
              targetRect: { height: 230, width: 310, x: 15, y: 25 },
            },
          ],
          window: {
            activeTerminalPanelId: "7::terminal-1",
            inputRoutingStaleDiscardCount: 2,
            keyboardFocusTarget: {
              kind: "terminal",
              panelId: "7::terminal-1",
            },
            terminalTargetCount: 1,
            webOverlayRectCount: 0,
          },
        })
      ),
      detachWindow: vi.fn(),
      hideTerminal: vi.fn(),
      reconcileTerminals: vi.fn(),
      setFrame: vi.fn(),
      setKeyboardForwardCallback: vi.fn(),
      setModifierForwardCallback: vi.fn(),
      setMouseForwardCallback: vi.fn(),
      setPwdForwardCallback: vi.fn(),
      setTerminalConfig: vi.fn(),
      setTerminalFocusRequestCallback: vi.fn(),
      setTerminalFont: vi.fn(),
      setTitleForwardCallback: vi.fn(),
      setupWindow: vi.fn(() => true),
      showTerminal: vi.fn(),
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

    vi.doMock("electron", () => ({}));
    vi.doMock("node:module", () => ({
      createRequire: vi.fn(() => vi.fn(() => fakeAddon)),
      default: {
        createRequire: vi.fn(() => vi.fn(() => fakeAddon)),
      },
    }));
    vi.doMock("@main/state/terminal-session-state.ts", () => ({
      archiveTerminalPanelSession: vi.fn(async () => undefined),
      readTerminalPanelSession: vi.fn(async () => null),
      removeTerminalPanelSession: vi.fn(async () => undefined),
      updateTerminalPanelCwd: vi.fn(async () => undefined),
      updateTerminalPanelTitle: vi.fn(async () => undefined),
    }));
    vi.doMock("@main/windows/window-identity.ts", () => ({
      findAppWindowByElectronId: vi.fn((id: number) =>
        id === win.id ? win : null
      ),
      findAppWindowByWebContents: vi.fn(() => win),
      findInternalWindowId: vi.fn(() => "main"),
      findWindowSessionId: vi.fn(() => "session-main"),
    }));

    const { registerTerminalIpc } = await import("@main/ipc/terminal.ts");
    registerTerminalIpc(fakeIpcMain as never);

    return { fakeAddon, handlers, invokeHandlers, win };
  }

  it("returns native surfaces with raw panel ids and recent route events", async () => {
    const { fakeAddon, handlers, invokeHandlers, win } = await setupHarness();

    handlers.get("pier:terminal:show")?.(
      { sender: win.webContents },
      "terminal-1"
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
            hostKeyboardActive: true,
            isSurfaceFocused: false,
            nativePanelId: "7::terminal-1",
            panelId: "terminal-1",
          },
        ],
        window: {
          activeTerminalPanelId: "terminal-1",
          inputRoutingStaleDiscardCount: 2,
          keyboardFocusTarget: {
            kind: "terminal",
            panelId: "terminal-1",
          },
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
          action: "show",
          panelId: "terminal-1",
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
});
