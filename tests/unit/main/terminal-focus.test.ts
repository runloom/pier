import { beforeEach, describe, expect, it, vi } from "vitest";

describe("terminal focus restoration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function setupTerminalFocusHarness() {
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
      setOverlayActive: vi.fn(),
      setPwdForwardCallback: vi.fn(),
      setTerminalFont: vi.fn(),
      setTitleForwardCallback: vi.fn(),
      setupWindow: vi.fn(),
      showTerminal: vi.fn(),
    };
    const createFakeWindow = () => ({
      focus: vi.fn(),
      getNativeWindowHandle: () => Buffer.from("window"),
      id: 7,
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      webContents: {
        focus: vi.fn(),
        isDestroyed: () => false,
        send: vi.fn(),
      },
    });
    const ipcWindow = createFakeWindow();
    const restoreWindow = createFakeWindow();
    const fakeIpcMain = {
      handle: vi.fn(),
      on: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    };

    vi.doMock("electron", () => ({
      BrowserWindow: {
        fromId: vi.fn(),
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
});
