import { beforeEach, describe, expect, it, vi } from "vitest";

describe("terminal focus restoration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function setupTerminalFocusHarness(
    opts: { ipcWindowFocused?: boolean } = {}
  ) {
    const invokeHandlers = new Map<string, (...args: unknown[]) => unknown>();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const fakeAddon = {
      applyTerminalTheme: vi.fn(),
      closeAllTerminals: vi.fn(),
      closeTerminal: vi.fn(),
      createTerminal: vi.fn(() => true),
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
      setupWindow: vi.fn(() => true),
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
      setBackgroundColor: vi.fn(),
      webContents: {
        focus: vi.fn(),
        isDestroyed: () => false,
        send: vi.fn(),
      },
    });
    const ipcWindow = createFakeWindow(opts.ipcWindowFocused ?? true);
    const restoreWindow = createFakeWindow();
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
      // terminal.ts only imports Electron types at runtime now.
    }));
    vi.doMock("node:module", () => ({
      createRequire: vi.fn(() => vi.fn(() => fakeAddon)),
      default: {
        createRequire: vi.fn(() => vi.fn(() => fakeAddon)),
      },
    }));
    vi.doMock("@main/state/terminal-session-state.ts", () => ({
      readTerminalPanelSession: vi.fn(async () => ({
        cwd: "/Users/xyz/ABC/pier",
        updatedAt: "2026-06-24T00:00:00.000Z",
      })),
      updateTerminalPanelCwd: vi.fn(async () => undefined),
      updateTerminalPanelTitle: vi.fn(async () => undefined),
    }));
    vi.doMock("@main/windows/window-identity.ts", () => ({
      findAppWindowByElectronId: vi.fn((id: number) =>
        id === ipcWindow.id ? ipcWindow : null
      ),
      findAppWindowByWebContents: vi.fn(() => ipcWindow),
      findInternalWindowId: vi.fn(() => "main"),
      findWindowSessionId: vi.fn(() => "session-main"),
    }));

    const { registerTerminalIpc, restoreActivePanelFocus } = await import(
      "@main/ipc/terminal.ts"
    );

    registerTerminalIpc(fakeIpcMain as never);
    return {
      fakeAddon,
      handlers,
      invokeHandlers,
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
    expect(fakeAddon.focusTerminal).toHaveBeenCalledWith("7::panel-1");
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
    expect(fakeAddon.focusTerminal).toHaveBeenCalledWith("7::panel-1");
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

    expect(fakeAddon.focusTerminal).toHaveBeenCalledWith("7::panel-1");
  });

  it("forwards native terminal focus requests to source window renderer (unscoped panelId)", async () => {
    // swift 端 forward callback 传的是 scoped panelId (因为 createTerminal 时
    // main 用 scoped key 写进了 swift terminals dict), main 必须 unscope 后给 renderer
    // — React/dockview 的 panel id 是 raw.
    const { fakeAddon, ipcWindow } = await setupTerminalFocusHarness();
    const focusForward =
      fakeAddon.setTerminalFocusRequestCallback.mock.calls[0]?.[0];

    focusForward?.(ipcWindow.id, "7::panel-2");

    expect(ipcWindow.webContents.send).toHaveBeenCalledWith(
      "pier:terminal:focus-request",
      { panelId: "panel-2" }
    );
  });

  it("passes the saved cwd when creating a new native terminal", async () => {
    const { fakeAddon, invokeHandlers, ipcWindow } =
      await setupTerminalFocusHarness();

    const result = await invokeHandlers.get("pier:terminal:create")?.(
      { sender: ipcWindow.webContents },
      {
        font: { family: "Menlo", size: 13 },
        frame: { x: 1, y: 2, width: 300, height: 200 },
        panelId: "terminal-1",
      }
    );

    expect(result).toEqual({ ok: true });
    expect(fakeAddon.createTerminal).toHaveBeenCalledWith(
      Buffer.from("window"),
      "7::terminal-1",
      { x: 1, y: 2, width: 300, height: 200 },
      "Menlo",
      13,
      "/Users/xyz/ABC/pier"
    );
  });

  it("prefers a saved cwd over a stale renderer-provided initial cwd", async () => {
    const { fakeAddon, invokeHandlers, ipcWindow } =
      await setupTerminalFocusHarness();

    const result = await invokeHandlers.get("pier:terminal:create")?.(
      { sender: ipcWindow.webContents },
      {
        cwd: "/Users/xyz/ABC/original-open",
        font: { family: "Menlo", size: 13 },
        frame: { x: 1, y: 2, width: 300, height: 200 },
        panelId: "terminal-1",
      }
    );

    expect(result).toEqual({ ok: true });
    expect(fakeAddon.createTerminal).toHaveBeenCalledWith(
      Buffer.from("window"),
      "7::terminal-1",
      { x: 1, y: 2, width: 300, height: 200 },
      "Menlo",
      13,
      "/Users/xyz/ABC/pier"
    );
  });

  it("does not make the host window transparent during terminal setup", async () => {
    const { fakeAddon, invokeHandlers, ipcWindow } =
      await setupTerminalFocusHarness();

    const result = invokeHandlers.get("pier:terminal:setup")?.({
      sender: ipcWindow.webContents,
    });

    expect(result).toEqual({ ok: true });
    expect(ipcWindow.setBackgroundColor).not.toHaveBeenCalled();
    expect(fakeAddon.setupWindow).toHaveBeenCalledWith(
      Buffer.from("window"),
      ipcWindow.id
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

  it("restoreActivePanelFocus on minimized window calls win.restore() first (#15)", async () => {
    // window 从 dock 点回恢复:BrowserWindow focus 事件 fire 时 isMinimized 可能仍是
    // true (取决于 OS timing), restoreActivePanelFocus 必须先 win.restore() 让窗口
    // 真正出来, 再做后续 terminal focus 恢复, 否则 makeFirstResponder 在最小化窗口上
    // 是 silent no-op.
    const { handlers, ipcWindow, restoreActivePanelFocus } =
      await setupTerminalFocusHarness();
    const minimizedWindow = {
      focus: vi.fn(),
      getNativeWindowHandle: () => Buffer.from("window"),
      id: 7,
      isDestroyed: () => false,
      isFocused: () => true,
      isMinimized: () => true,
      restore: vi.fn(),
      webContents: {
        focus: vi.fn(),
        isDestroyed: () => false,
        send: vi.fn(),
      },
    };

    handlers.get("pier:terminal:set-active-panel-kind")?.(
      { sender: ipcWindow.webContents },
      "terminal",
      "panel-1"
    );
    restoreActivePanelFocus(minimizedWindow as never);

    expect(minimizedWindow.restore).toHaveBeenCalledOnce();
    expect(minimizedWindow.focus).toHaveBeenCalledOnce();
    // restore 必须在 focus 之前, 否则 focus 调用没有可见效果
    const restoreOrder = minimizedWindow.restore.mock.invocationCallOrder[0];
    const focusOrder = minimizedWindow.focus.mock.invocationCallOrder[0];
    expect(focusOrder).toBeGreaterThan(restoreOrder ?? 0);
  });

  it("blurActivePanelFocus tolerates destroyed window (no throw)", async () => {
    // window close 跟 blur 事件可能 race:window.on("blur") fire 后 micro-task 内
    // window 已被销毁. blurActivePanelFocus 必须 guard isDestroyed, 否则
    // win.getNativeWindowHandle() 抛 native error 跨 process 难调试.
    const destroyedWindow = {
      focus: vi.fn(),
      getNativeWindowHandle: () => {
        throw new Error("window destroyed");
      },
      id: 99,
      isDestroyed: () => true,
      isFocused: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      webContents: {
        focus: vi.fn(),
        isDestroyed: () => true,
        send: vi.fn(),
      },
    };
    await setupTerminalFocusHarness();
    const { blurActivePanelFocus } = await import("@main/ipc/terminal.ts");

    expect(() => blurActivePanelFocus(destroyedWindow as never)).not.toThrow();
  });
});
