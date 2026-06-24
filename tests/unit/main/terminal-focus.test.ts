import { beforeEach, describe, expect, it, vi } from "vitest";

describe("terminal focus restoration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function setupTerminalFocusHarness(
    opts: { ipcWindowFocused?: boolean } = {}
  ) {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const fakeAddon = {
      applyTerminalTheme: vi.fn(),
      closeAllTerminals: vi.fn(),
      closeTerminal: vi.fn(),
      createTerminal: vi.fn(),
      detachWindow: vi.fn(),
      focusTerminal: vi.fn(),
      hideTerminal: vi.fn(),
      reconcileTerminals: vi.fn(),
      setActivePanelKind: vi.fn(),
      setFrame: vi.fn(),
      setKeyboardForwardCallback: vi.fn(),
      setMouseForwardCallback: vi.fn(),
      setTerminalFocusRequestCallback: vi.fn(),
      setOverlayActive: vi.fn(),
      setPwdForwardCallback: vi.fn(),
      setTerminalFont: vi.fn(),
      setTitleForwardCallback: vi.fn(),
      setupWindow: vi.fn(),
      showTerminal: vi.fn(),
    };
    const createFakeWindow = (focused = true) => ({
      focus: vi.fn(),
      getNativeWindowHandle: () => Buffer.from("window"),
      id: 7,
      isDestroyed: () => false,
      isFocused: () => focused,
      isMinimized: () => false,
      restore: vi.fn(),
      webContents: {
        focus: vi.fn(),
        isDestroyed: () => false,
        send: vi.fn(),
      },
    });
    const ipcWindow = createFakeWindow(opts.ipcWindowFocused ?? true);
    const restoreWindow = createFakeWindow();
    const fakeIpcMain = {
      handle: vi.fn(),
      on: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    };

    vi.doMock("electron", () => ({
      BrowserWindow: {
        fromId: vi.fn((id: number) => (id === ipcWindow.id ? ipcWindow : null)),
        fromWebContents: vi.fn(() => ipcWindow),
      },
    }));
    vi.doMock("node:module", () => ({
      createRequire: vi.fn(() => vi.fn(() => fakeAddon)),
      default: {
        createRequire: vi.fn(() => vi.fn(() => fakeAddon)),
      },
    }));

    const { registerTerminalIpc, restoreActivePanelFocus } = await import(
      "@main/ipc/terminal.ts"
    );

    registerTerminalIpc(fakeIpcMain as never);
    return {
      fakeAddon,
      handlers,
      ipcWindow,
      restoreActivePanelFocus,
      restoreWindow,
    };
  }

  it("restores a native terminal panel recorded by active panel sync", async () => {
    const {
      fakeAddon,
      handlers,
      ipcWindow,
      restoreActivePanelFocus,
      restoreWindow,
    } = await setupTerminalFocusHarness();

    handlers.get("pier:terminal:set-active-panel-kind")?.(
      { sender: ipcWindow.webContents },
      "terminal",
      "panel-1"
    );

    restoreActivePanelFocus(restoreWindow as never);

    expect(restoreWindow.focus).toHaveBeenCalledOnce();
    expect(fakeAddon.focusTerminal).toHaveBeenCalledWith("panel-1");
    expect(restoreWindow.webContents.focus).not.toHaveBeenCalled();
  });

  it("restores a native terminal panel recorded by terminal focus", async () => {
    const {
      fakeAddon,
      handlers,
      ipcWindow,
      restoreActivePanelFocus,
      restoreWindow,
    } = await setupTerminalFocusHarness();

    handlers.get("pier:terminal:focus")?.(
      { sender: ipcWindow.webContents },
      "panel-1"
    );
    fakeAddon.focusTerminal.mockClear();

    restoreActivePanelFocus(restoreWindow as never);

    expect(restoreWindow.focus).toHaveBeenCalledOnce();
    expect(fakeAddon.focusTerminal).toHaveBeenCalledWith("panel-1");
    expect(restoreWindow.webContents.focus).not.toHaveBeenCalled();
  });

  it("records but does not focus a terminal panel while its window is blurred", async () => {
    const { fakeAddon, handlers, ipcWindow, restoreActivePanelFocus } =
      await setupTerminalFocusHarness({ ipcWindowFocused: false });

    handlers.get("pier:terminal:focus")?.(
      { sender: ipcWindow.webContents },
      "panel-1"
    );

    expect(fakeAddon.focusTerminal).not.toHaveBeenCalled();
    expect(fakeAddon.setActivePanelKind).toHaveBeenCalledWith(
      Buffer.from("window"),
      1,
      null
    );

    restoreActivePanelFocus(ipcWindow as never);

    expect(fakeAddon.focusTerminal).toHaveBeenCalledWith("panel-1");
  });

  it("forwards native terminal focus requests to the source window renderer", async () => {
    const { fakeAddon, ipcWindow } = await setupTerminalFocusHarness();
    const focusForward =
      fakeAddon.setTerminalFocusRequestCallback.mock.calls[0]?.[0];

    focusForward?.(ipcWindow.id, "panel-2");

    expect(ipcWindow.webContents.send).toHaveBeenCalledWith(
      "pier:terminal:focus-request",
      { panelId: "panel-2" }
    );
  });

  it("blurs native terminal focus when the owning window loses focus", async () => {
    const { fakeAddon, handlers, ipcWindow } =
      await setupTerminalFocusHarness();
    const { blurActivePanelFocus } = await import("@main/ipc/terminal.ts");

    handlers.get("pier:terminal:set-active-panel-kind")?.(
      { sender: ipcWindow.webContents },
      "terminal",
      "panel-1"
    );
    fakeAddon.setActivePanelKind.mockClear();

    blurActivePanelFocus(ipcWindow as never);

    expect(fakeAddon.setActivePanelKind).toHaveBeenCalledWith(
      Buffer.from("window"),
      1,
      null
    );
  });
});
