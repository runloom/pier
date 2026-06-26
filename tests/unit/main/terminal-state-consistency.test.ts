import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Swift 端跨 setupWindow / focus / show / setFrame / close / blur 多条路径的 state
 * 一致性保护. 直接调 swift 的 state 在 TS 内拿不到, 这里通过 main 端 IPC handler
 * 驱动 + spy addon 方法调用形态, 等价于"main 端正确转发了 user-visible 状态转移".
 *
 * 重点关注:
 * - hide IPC main 端总是 forward 给 swift, swift 内部直接执行 (移 offscreen +
 *   remove EventRouter targets). 切 tab 场景旧 panel 必须真 hide 让出 z-order,
 *   drag 场景靠后续 setFrame 把 NSView 移回新位置自动恢复 visible.
 * - set-active-panel-kind 切到 web 时, main 主动 webContents.focus() — 这是
 *   Electron 的标准路径, swift applyFirstResponder web 分支已 no-op, 由 main 负责.
 * - 跨 BrowserWindow 失焦的 set-active-panel-kind("terminal", id), main 端走
 *   blurActivePanelFocus 而不是 setActivePanelKind, 防止 swift 抢一个不在前台
 *   窗口的 firstResponder.
 */
describe("Swift terminal state consistency via main IPC paths", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function setupHarness(opts: { winFocused?: boolean } = {}) {
    const winFocused = opts.winFocused ?? true;
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
      performTerminalBindingAction: vi.fn(() => true),
      reconcileTerminals: vi.fn(),
      setActivePanelKind: vi.fn(),
      setFrame: vi.fn(),
      setKeyboardForwardCallback: vi.fn(),
      setMouseForwardCallback: vi.fn(),
      setOverlayActive: vi.fn(),
      setPwdForwardCallback: vi.fn(),
      setTerminalConfig: vi.fn(),
      setTerminalFocusRequestCallback: vi.fn(),
      setTerminalFont: vi.fn(),
      setTitleForwardCallback: vi.fn(),
      setupWindow: vi.fn(),
      showTerminal: vi.fn(),
    };
    const win = {
      focus: vi.fn(),
      getNativeWindowHandle: () => Buffer.from("window"),
      id: 7,
      isDestroyed: () => false,
      isFocused: () => winFocused,
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
      // terminal.ts only imports Electron types at runtime now.
    }));
    vi.doMock("node:module", () => ({
      createRequire: vi.fn(() => vi.fn(() => fakeAddon)),
      default: {
        createRequire: vi.fn(() => vi.fn(() => fakeAddon)),
      },
    }));
    vi.doMock("@main/state/terminal-session-state.ts", () => ({
      readTerminalPanelSession: vi.fn(async () => null),
      removeTerminalPanelSession: vi.fn(async () => undefined),
      updateTerminalPanelContext: vi.fn(async () => undefined),
      updateTerminalPanelTitle: vi.fn(async () => undefined),
    }));
    vi.doMock("@main/state/panel-context-state.ts", () => ({
      recordRecentPanelContext: vi.fn(async () => undefined),
    }));
    vi.doMock("@main/services/panel-context-resolver.ts", () => ({
      resolvePanelContextForPath: vi.fn(async (path: string) => ({
        contextId: `ctx:${path}`,
        cwd: path,
        openedPath: path,
        projectRoot: path,
        source: "panel",
        updatedAt: 1,
        worktreeKey: path,
      })),
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

  it("forwards hide IPC unconditionally (no main-side filtering)", async () => {
    // 关键防回归:hide 由 swift 端单一执行, main 端透传不过滤. 历史上 swift 端
    // 加过 `guard panelId != activePanelId` 防御性 guard, 结果在 tab switch 场景
    // 里旧 active panel 的 hide 被错跳过, z-order 没让出, user 看不到新 tab.
    // 现在 swift hide 总是执行, drag 场景靠 setFrame 把 NSView 移回新位置恢复 visible.
    const { fakeAddon, handlers, win } = await setupHarness();

    handlers.get("pier:terminal:set-active-panel-kind")?.(
      { sender: win.webContents },
      "terminal",
      "panel-1"
    );
    fakeAddon.hideTerminal.mockClear();

    handlers.get("pier:terminal:hide")?.(
      { sender: win.webContents },
      "panel-1"
    );

    expect(fakeAddon.hideTerminal).toHaveBeenCalledWith("7::panel-1");
  });

  it("delegates web focus to webContents (not swift firstResponder)", async () => {
    // swift applyFirstResponder web 分支已 no-op, 由 main 调 webContents.focus() 让
    // Chromium 的 RenderWidgetHostViewCocoa 拿 firstResponder. Electron 42 用 Chromium
    // 不是 WebKit, 没有真 WKWebView, 旧版本 swift 端 makeFirstResponder(WKWebView) 找
    // 错 type 跑空, 改 webContents.focus() 跨平台一致.
    const { handlers, win } = await setupHarness();

    handlers.get("pier:terminal:set-active-panel-kind")?.(
      { sender: win.webContents },
      "web",
      "welcome-1"
    );

    expect(win.webContents.focus).toHaveBeenCalled();
  });

  it("does not steal focus for a background window when asked to set terminal active", async () => {
    // 多 BrowserWindow 场景: window A 在前台 active panel 改了, window B 也收到 IPC
    // 但 B.isFocused()=false. main 必须走 blurActivePanelFocus 把 B 的 swift state 设
    // web/null, 防止 B 的 terminal NSView 在后台抢 NSApp 的 firstResponder 干扰前台.
    const { fakeAddon, handlers, win } = await setupHarness({
      winFocused: false,
    });

    handlers.get("pier:terminal:set-active-panel-kind")?.(
      { sender: win.webContents },
      "terminal",
      "panel-1"
    );

    // 不是直接 setActivePanelKind(.terminal), 而是 setActivePanelKind(.web, null) 来 blur
    expect(fakeAddon.setActivePanelKind).toHaveBeenCalledWith(
      Buffer.from("window"),
      1, // 1 = web
      null
    );
    expect(fakeAddon.focusTerminal).not.toHaveBeenCalled();
  });

  it("close IPC removes both swift terminal NSView and persisted cwd session", async () => {
    // close 路径必须双侧清理:swift 端释放 NSView (closeTerminal) + main 端删 session
    // state (removeTerminalPanelSession 让下次 fresh 创建 panel 同 id 时不会 reload
    // 旧 cwd). 缺一边都会导致 stale state 泄漏.
    const { fakeAddon, handlers, win } = await setupHarness();
    const sessionState = await import("@main/state/terminal-session-state.ts");

    handlers.get("pier:terminal:close")?.(
      { sender: win.webContents },
      "panel-1"
    );

    // wait microtask for the async removeTerminalPanelSession promise to resolve
    await new Promise((resolve) => setImmediate(resolve));

    expect(fakeAddon.closeTerminal).toHaveBeenCalledWith("7::panel-1");
    expect(sessionState.removeTerminalPanelSession).toHaveBeenCalledWith(
      "session-main",
      "panel-1"
    );
  });

  it("persists the initial context after native terminal creation succeeds", async () => {
    const { invokeHandlers, win } = await setupHarness();
    const sessionState = await import("@main/state/terminal-session-state.ts");
    const context = {
      contextId: "ctx-pier",
      cwd: "/Users/xyz/ABC/pier",
      openedPath: "/Users/xyz/ABC/pier",
      projectRoot: "/Users/xyz/ABC/pier",
      source: "command" as const,
      updatedAt: 1,
      worktreeKey: "/Users/xyz/ABC/pier",
    };

    await invokeHandlers.get("pier:terminal:create")?.(
      { sender: win.webContents },
      {
        context,
        font: { family: "Menlo", size: 13 },
        frame: { height: 400, width: 600, x: 0, y: 0 },
        panelId: "terminal-1",
      }
    );

    expect(sessionState.updateTerminalPanelContext).toHaveBeenCalledWith(
      "session-main",
      "terminal-1",
      context
    );
  });

  it("maps terminal operation IPC to allowlisted Ghostty binding actions", async () => {
    const { fakeAddon, invokeHandlers, win } = await setupHarness();

    const result = await invokeHandlers.get(
      "pier:terminal:perform-operation"
    )?.({ sender: win.webContents }, "terminal-1", "clearScreen");

    expect(result).toEqual({ ok: true });
    expect(fakeAddon.performTerminalBindingAction).toHaveBeenCalledWith(
      "7::terminal-1",
      "clear_screen"
    );
  });

  it("rejects unknown terminal operations before reaching native", async () => {
    const { fakeAddon, invokeHandlers, win } = await setupHarness();

    const result = await invokeHandlers.get(
      "pier:terminal:perform-operation"
    )?.({ sender: win.webContents }, "terminal-1", "openDevTools");

    expect(result).toEqual({
      ok: false,
      error: "invalid terminal operation",
    });
    expect(fakeAddon.performTerminalBindingAction).not.toHaveBeenCalled();
  });

  it("persists forwarded terminal titles using the raw renderer panel id", async () => {
    const { fakeAddon, win } = await setupHarness();
    const sessionState = await import("@main/state/terminal-session-state.ts");
    const callback = fakeAddon.setTitleForwardCallback.mock.calls[0]?.[0] as
      | ((windowId: number, panelId: string, title: string) => void)
      | undefined;

    callback?.(win.id, "7::terminal-1", "Claude Code");

    await new Promise((resolve) => setImmediate(resolve));

    expect(sessionState.updateTerminalPanelTitle).toHaveBeenCalledWith(
      "session-main",
      "terminal-1",
      "Claude Code"
    );
    expect(win.webContents.send).toHaveBeenCalledWith(
      "pier:terminal:title-change",
      {
        panelId: "terminal-1",
        title: "Claude Code",
      }
    );
  });

  it("set-frame forwards transparently — swift owns frame coordinate handling", async () => {
    // 防回归:main 端不做 Y-flip / 不解释 viewport. React 传什么坐标 main 原样转给
    // swift, swift 内 computeFrame 才 flip Y 给 NSView.frame. 这条边界换地方会 break
    // hitTest 一致性 (见 tests/unit/native-terminal-hit-target-coords.test.ts).
    // 注:main 给 panelId 加 `${win.id}::` scope 前缀防多窗口冲突, 但不动 frame.
    const { fakeAddon, handlers, win } = await setupHarness();

    const frame = { x: 100, y: 200, width: 300, height: 400 };
    handlers.get("pier:terminal:set-frame")?.(
      { sender: win.webContents },
      "panel-1",
      frame
    );

    expect(fakeAddon.setFrame).toHaveBeenCalledWith("7::panel-1", frame);
  });

  it("reconcile IPC scopes panelIds with window id (no orphan cross-window)", async () => {
    // C 方案 reload 零销毁路径:renderer 重建后报告"我现在还需要这些 panelId",
    // swift 端 close 不在集合的孤儿 NSView. main 必须每个 id 加 ${win.id}:: scope
    // 防止跨窗口同 panelId 互相 close.
    const { fakeAddon, handlers, win } = await setupHarness();

    handlers.get("pier:terminal:reconcile")?.({ sender: win.webContents }, [
      "panel-a",
      "panel-b",
    ]);

    expect(fakeAddon.reconcileTerminals).toHaveBeenCalledWith(
      Buffer.from("window"),
      ["7::panel-a", "7::panel-b"]
    );
  });

  it("activates web focus only when terminal overlay is enabled", async () => {
    const { fakeAddon, handlers, win } = await setupHarness();

    handlers.get("pier:terminal:set-overlay")?.(
      { sender: win.webContents },
      true
    );

    expect(fakeAddon.setOverlayActive).toHaveBeenCalledWith(
      Buffer.from("window"),
      true
    );
    expect(win.webContents.focus).toHaveBeenCalledOnce();

    vi.mocked(win.webContents.focus).mockClear();

    handlers.get("pier:terminal:set-overlay")?.(
      { sender: win.webContents },
      false
    );

    expect(fakeAddon.setOverlayActive).toHaveBeenLastCalledWith(
      Buffer.from("window"),
      false
    );
    expect(win.webContents.focus).not.toHaveBeenCalled();
  });

  it("routes terminal theme application through the sender window", async () => {
    const { fakeAddon, handlers, win } = await setupHarness();
    const colors = {
      background: "#000000",
      black: "#000000",
      blue: "#0000ff",
      brightBlack: "#111111",
      brightBlue: "#2222ff",
      brightCyan: "#22ffff",
      brightGreen: "#22ff22",
      brightMagenta: "#ff22ff",
      brightRed: "#ff2222",
      brightWhite: "#ffffff",
      brightYellow: "#ffff22",
      cursor: "#ffffff",
      cyan: "#00ffff",
      foreground: "#ffffff",
      green: "#00ff00",
      magenta: "#ff00ff",
      red: "#ff0000",
      selection: "#333333",
      white: "#eeeeee",
      yellow: "#ffff00",
    };

    handlers.get("pier:terminal:apply-theme")?.(
      { sender: win.webContents },
      colors
    );

    expect(fakeAddon.applyTerminalTheme).toHaveBeenCalledWith(
      Buffer.from("window"),
      colors
    );
  });

  it("routes terminal font application through the sender window", async () => {
    const { fakeAddon, handlers, win } = await setupHarness();

    handlers.get("pier:terminal:set-font")?.(
      { sender: win.webContents },
      "panel-1",
      { family: "Menlo", size: 14 }
    );

    expect(fakeAddon.setTerminalFont).toHaveBeenCalledWith(
      Buffer.from("window"),
      "Menlo",
      14
    );
  });

  it("routes terminal runtime config through the sender window", async () => {
    const { fakeAddon, handlers, win } = await setupHarness();
    const config = {
      cursorStyle: "bar",
      cursorBlink: false,
      scrollbackLimitBytes: 128_000_000,
      pasteProtection: false,
    };

    handlers.get("pier:terminal:set-config")?.(
      { sender: win.webContents },
      config
    );

    expect(fakeAddon.setTerminalConfig).toHaveBeenCalledWith(
      Buffer.from("window"),
      config
    );
  });
});
