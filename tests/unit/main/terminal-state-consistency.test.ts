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
 * - input routing 切到 Web 时, main 主动 webContents.focus() — 这是
 *   Electron 的标准路径, swift Web keyboard target 分支已 no-op, 由 main 负责.
 * - 跨 BrowserWindow 失焦的 terminal keyboard target, main 端走 blurActivePanelFocus
 *   防止后台 terminal NSView 抢前台窗口的 firstResponder.
 */
describe("Swift terminal state consistency via main IPC paths", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function setupHarness(
    opts: {
      recordAgentLaunch?: (agentId: string) => void;
      savedSession?: unknown;
      winFocused?: boolean;
    } = {}
  ) {
    const winFocused = opts.winFocused ?? true;
    const invokeHandlers = new Map<string, (...args: unknown[]) => unknown>();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const fakeAddon = {
      applyTerminalInputRouting: vi.fn(),
      applyTerminalPresentation: vi.fn(),
      applyTerminalTheme: vi.fn(),
      closeAllTerminals: vi.fn(),
      closeTerminal: vi.fn(),
      createTerminal: vi.fn(() => true),
      detachWindow: vi.fn(),
      hideTerminal: vi.fn(),
      performTerminalBindingAction: vi.fn(() => true),
      reconcileTerminals: vi.fn(),
      setFrame: vi.fn(),
      setKeyboardForwardCallback: vi.fn(),
      setModifierForwardCallback: vi.fn(),
      setMouseForwardCallback: vi.fn(),
      setPwdForwardCallback: vi.fn(),
      setSearchForwardCallback: vi.fn(),
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
      app: { getPath: vi.fn((k: string) => `/tmp/pier-test-${k}`) },
    }));
    vi.doMock("@main/state/terminal-session-state.ts", () => ({
      clearTerminalPanelAgent: vi.fn(async () => undefined),
      patchTerminalPanelAgentStatus: vi.fn(async () => false),
      patchTerminalPanelTab: vi.fn(async () => undefined),
      patchTerminalPanelTaskStatus: vi.fn(async () => true),
      readTerminalPanelSession: vi.fn(async () => opts.savedSession ?? null),
      removeTerminalPanelSession: vi.fn(async () => undefined),
      updateTerminalPanelAgent: vi.fn(async () => undefined),
      updateTerminalPanelAgentResume: vi.fn(async () => true),
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
    }));

    const { registerTerminalIpc } = await import("@main/ipc/terminal.ts");
    registerTerminalIpc(fakeIpcMain as never, {
      loadNativeAddon: () => ({ addon: fakeAddon as never, error: null }),
      recordAgentLaunch: opts.recordAgentLaunch as never,
    });

    return { fakeAddon, handlers, invokeHandlers, win };
  }

  function terminalPresentation(panelId = "panel-1", rendererSequence = 1) {
    return {
      activePanelId: panelId,
      activeTerminalPanelId: panelId,
      hasMaximizedGroup: false,
      reason: "dockview-active-panel" as const,
      rendererSequence,
      terminals: [
        {
          focused: false,
          frame: { height: 400, width: 300, x: 0, y: 0 },
          panelId,
          visible: true,
        },
      ],
    };
  }

  it("forwards hide IPC unconditionally (no main-side filtering)", async () => {
    // 关键防回归:hide 由 swift 端单一执行, main 端透传不过滤. 历史上 swift 端
    // 加过 `guard panelId != activePanelId` 防御性 guard, 结果在 tab switch 场景
    // 里旧 active panel 的 hide 被错跳过, z-order 没让出, user 看不到新 tab.
    // 现在 swift hide 总是执行, drag 场景靠 setFrame 把 NSView 移回新位置恢复 visible.
    const { fakeAddon, handlers, win } = await setupHarness();

    fakeAddon.hideTerminal.mockClear();

    handlers.get("pier:terminal:hide")?.(
      { sender: win.webContents },
      "panel-1"
    );

    expect(fakeAddon.hideTerminal).toHaveBeenCalledWith("7::panel-1");
  });

  it("delegates Web keyboard focus to webContents", async () => {
    // swift applyFirstResponder web 分支已 no-op, 由 main 调 webContents.focus() 让
    // Chromium 的 RenderWidgetHostViewCocoa 拿 firstResponder. Electron 42 用 Chromium
    // 不是 WebKit, 没有真 WKWebView, 旧版本 swift 端 makeFirstResponder(WKWebView) 找
    // 错 type 跑空, 改 webContents.focus() 跨平台一致.
    const { handlers, win } = await setupHarness();

    handlers.get("pier:terminal:apply-input-routing")?.(
      { sender: win.webContents },
      {
        basePanel: { kind: "web" },
        webRequestCount: 0,
        rendererSequence: 1,
        webOverlayRects: [],
      }
    );

    expect(win.webContents.focus).toHaveBeenCalled();
  });

  it("does not derive terminal keyboard focus from presentation in a background window", async () => {
    // 多 BrowserWindow 场景: window A 在前台 active panel 改了, window B 也收到 IPC
    // 但 B.isFocused()=false. presentation 只描述 layout/visibility; keyboard target
    // 必须来自 renderer input routing 快照. 缺快照时兜底 Web, 防止后台 terminal
    // NSView 抢 NSApp 的 firstResponder 干扰前台.
    const { fakeAddon, handlers, win } = await setupHarness({
      winFocused: false,
    });

    handlers.get("pier:terminal:apply-presentation")?.(
      { sender: win.webContents },
      terminalPresentation("panel-1")
    );

    expect(fakeAddon.applyTerminalPresentation).toHaveBeenCalledWith(
      Buffer.from("window"),
      expect.objectContaining({
        activePanelId: "7::panel-1",
        activeTerminalPanelId: "7::panel-1",
        terminals: [
          expect.objectContaining({
            focused: false,
            panelId: "7::panel-1",
            visible: true,
          }),
        ],
        windowFocused: false,
      })
    );
    expect(fakeAddon.applyTerminalInputRouting).toHaveBeenCalledWith(
      Buffer.from("window"),
      expect.objectContaining({
        basePanel: { kind: "web" },
        windowFocused: false,
      })
    );
  });

  it("close IPC removes both swift terminal NSView and persisted cwd session", async () => {
    // close 路径必须双侧清理:swift 端释放 NSView (closeTerminal) + main 端删 session
    // state (removeTerminalPanelSession 让下次 fresh 创建 panel 同 id 时不会 reload
    // 旧 cwd). 缺一边都会导致 stale state 泄漏.
    const { fakeAddon, invokeHandlers, win } = await setupHarness();
    const sessionState = await import("@main/state/terminal-session-state.ts");

    await invokeHandlers.get("pier:terminal:close")?.(
      { sender: win.webContents },
      "panel-1"
    );

    expect(fakeAddon.closeTerminal).toHaveBeenCalledWith("7::panel-1");
    expect(sessionState.removeTerminalPanelSession).toHaveBeenCalledWith(
      "main",
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
      "main",
      "terminal-1",
      context
    );
  });

  it("records agent usage only after native terminal creation succeeds", async () => {
    const recordAgentLaunch = vi.fn();
    const { invokeHandlers, win } = await setupHarness({ recordAgentLaunch });
    const { terminalLaunchRegistry } = await import(
      "@main/state/terminal-launch-state.ts"
    );
    const launchId = terminalLaunchRegistry.register({
      agentId: "codex",
      command: "codex",
    });

    await invokeHandlers.get("pier:terminal:create")?.(
      { sender: win.webContents },
      {
        font: { family: "Menlo", size: 13 },
        frame: { height: 400, width: 600, x: 0, y: 0 },
        launchId,
        panelId: "agent-terminal-1",
      }
    );

    expect(recordAgentLaunch).toHaveBeenCalledWith("codex");
  });

  it("does not fail an already-created terminal when usage recording fails", async () => {
    const recordAgentLaunch = vi.fn().mockRejectedValue(new Error("disk full"));
    const { invokeHandlers, win } = await setupHarness({ recordAgentLaunch });
    const { terminalLaunchRegistry } = await import(
      "@main/state/terminal-launch-state.ts"
    );
    const launchId = terminalLaunchRegistry.register({
      agentId: "codex",
      command: "codex",
    });

    const result = await invokeHandlers.get("pier:terminal:create")?.(
      { sender: win.webContents },
      {
        font: { family: "Menlo", size: 13 },
        frame: { height: 400, width: 600, x: 0, y: 0 },
        launchId,
        panelId: "agent-terminal-2",
      }
    );

    expect(result).toEqual({ ok: true });
  });

  it("does not count a restored agent session as a new user launch", async () => {
    const recordAgentLaunch = vi.fn();
    const { invokeHandlers, win } = await setupHarness({
      recordAgentLaunch,
      savedSession: {
        agent: {
          agentId: "codex",
          launch: { agentId: "codex", command: "codex" },
          startedAt: 1000,
          status: "running",
        },
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
    });

    await invokeHandlers.get("pier:terminal:create")?.(
      { sender: win.webContents },
      {
        font: { family: "Menlo", size: 13 },
        frame: { height: 400, width: 600, x: 0, y: 0 },
        panelId: "restored-agent-terminal",
      }
    );

    expect(recordAgentLaunch).not.toHaveBeenCalled();
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
      | ((
          windowId: number,
          panelId: string,
          lifecycleId: string,
          title: string
        ) => void)
      | undefined;

    callback?.(win.id, "7::terminal-1", "", "Claude Code");

    await new Promise((resolve) => setImmediate(resolve));

    expect(sessionState.updateTerminalPanelTitle).toHaveBeenCalledWith(
      "main",
      "terminal-1",
      "Claude Code"
    );
    expect(win.webContents.send).toHaveBeenCalledWith(
      "pier://terminal:title-changed",
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

  it("applies Web and terminal keyboard targets through input routing", async () => {
    const { fakeAddon, handlers, win } = await setupHarness();

    handlers.get("pier:terminal:apply-presentation")?.(
      { sender: win.webContents },
      terminalPresentation("panel-1")
    );
    vi.mocked(win.webContents.focus).mockClear();
    fakeAddon.applyTerminalInputRouting.mockClear();

    handlers.get("pier:terminal:apply-input-routing")?.(
      { sender: win.webContents },
      {
        basePanel: { kind: "web" },
        webRequestCount: 0,
        rendererSequence: 2,
        webOverlayRects: [
          { frame: { height: 400, width: 300, x: 0, y: 0 }, id: "dialog" },
        ],
      }
    );

    expect(fakeAddon.applyTerminalInputRouting).toHaveBeenCalledWith(
      Buffer.from("window"),
      expect.objectContaining({
        basePanel: { kind: "web" },
        webOverlayRects: [
          { frame: { height: 400, width: 300, x: 0, y: 0 }, id: "dialog" },
        ],
      })
    );
    expect(win.webContents.focus).not.toHaveBeenCalled();

    vi.mocked(win.webContents.focus).mockClear();
    fakeAddon.applyTerminalInputRouting.mockClear();

    handlers.get("pier:terminal:apply-input-routing")?.(
      { sender: win.webContents },
      {
        basePanel: { kind: "terminal", panelId: "panel-1" },
        webRequestCount: 0,
        rendererSequence: 3,
        webOverlayRects: [],
      }
    );

    expect(fakeAddon.applyTerminalInputRouting).toHaveBeenCalledWith(
      Buffer.from("window"),
      expect.objectContaining({
        basePanel: { kind: "terminal", panelId: "7::panel-1" },
        webOverlayRects: [],
      })
    );
    expect(win.webContents.focus).not.toHaveBeenCalled();
  });

  it("does not refocus WebContents when only Web overlay rects change", async () => {
    const { handlers, win } = await setupHarness();

    handlers.get("pier:terminal:apply-input-routing")?.(
      { sender: win.webContents },
      {
        basePanel: { kind: "web" },
        webRequestCount: 0,
        rendererSequence: 1,
        webOverlayRects: [
          { frame: { height: 24, width: 200, x: 10, y: 10 }, id: "search" },
        ],
      }
    );
    expect(win.webContents.focus).toHaveBeenCalledOnce();

    vi.mocked(win.webContents.focus).mockClear();
    handlers.get("pier:terminal:apply-input-routing")?.(
      { sender: win.webContents },
      {
        basePanel: { kind: "web" },
        webRequestCount: 0,
        rendererSequence: 2,
        webOverlayRects: [
          { frame: { height: 24, width: 240, x: 10, y: 10 }, id: "search" },
        ],
      }
    );

    expect(win.webContents.focus).not.toHaveBeenCalled();
  });

  it("rejects invalid input routing snapshots before native or Web focus side effects", async () => {
    const { fakeAddon, handlers, win } = await setupHarness();
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const invalidSnapshots: unknown[] = [
      {},
      {
        basePanel: { kind: "web" },
        webRequestCount: -1,
        rendererSequence: 1,
        webOverlayRects: [],
      },
      {
        basePanel: { kind: "web" },
        webRequestCount: 0,
        rendererSequence: -1,
        webOverlayRects: [],
      },
      {
        basePanel: { kind: "terminal" },
        webRequestCount: 0,
        rendererSequence: 1,
        webOverlayRects: [],
      },
      {
        basePanel: { kind: "web" },
        webRequestCount: 0,
        rendererSequence: 1,
        webOverlayRects: [
          { frame: { height: 1, width: 1, x: 0, y: 0 }, id: "dup" },
          { frame: { height: 1, width: 1, x: 2, y: 2 }, id: "dup" },
        ],
      },
      {
        basePanel: { kind: "web" },
        webRequestCount: 0,
        rendererSequence: 1,
        webOverlayRects: [
          {
            frame: { height: 1, width: 1, x: Number.POSITIVE_INFINITY, y: 0 },
            id: "bad-frame",
          },
        ],
      },
      {
        basePanel: { kind: "web" },
        webRequestCount: 0,
        rendererSequence: 1,
        webOverlayRects: Array.from({ length: 65 }, (_, index) => ({
          frame: { height: 1, width: 1, x: index, y: index },
          id: `rect-${index}`,
        })),
      },
    ];

    try {
      for (const snapshot of invalidSnapshots) {
        fakeAddon.applyTerminalInputRouting.mockClear();
        vi.mocked(win.webContents.focus).mockClear();

        handlers.get("pier:terminal:apply-input-routing")?.(
          { sender: win.webContents },
          snapshot
        );

        expect(fakeAddon.applyTerminalInputRouting).not.toHaveBeenCalled();
        expect(win.webContents.focus).not.toHaveBeenCalled();
      }
    } finally {
      errorSpy.mockRestore();
    }
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

  it("drops invalid terminal runtime config before calling the native addon", async () => {
    const { fakeAddon, handlers, win } = await setupHarness();

    handlers.get("pier:terminal:set-config")?.(
      { sender: win.webContents },
      {
        cursorStyle: undefined,
        cursorBlink: true,
        scrollbackLimitBytes: 64_000_000,
        pasteProtection: true,
      }
    );

    expect(fakeAddon.setTerminalConfig).not.toHaveBeenCalled();
  });

  it("maps terminal search IPC to scoped Ghostty binding actions", async () => {
    const { fakeAddon, invokeHandlers, win } = await setupHarness();

    await expect(
      invokeHandlers.get("pier:terminal:search")?.(
        { sender: win.webContents },
        "panel-1",
        "needle"
      )
    ).resolves.toEqual({ ok: true });
    await expect(
      invokeHandlers.get("pier:terminal:navigate-search")?.(
        { sender: win.webContents },
        "panel-1",
        "next"
      )
    ).resolves.toEqual({ ok: true });
    await expect(
      invokeHandlers.get("pier:terminal:navigate-search")?.(
        { sender: win.webContents },
        "panel-1",
        "previous"
      )
    ).resolves.toEqual({ ok: true });
    await expect(
      invokeHandlers.get("pier:terminal:end-search")?.(
        { sender: win.webContents },
        "panel-1"
      )
    ).resolves.toEqual({ ok: true });

    expect(fakeAddon.performTerminalBindingAction).toHaveBeenCalledWith(
      "7::panel-1",
      "search:needle"
    );
    expect(fakeAddon.performTerminalBindingAction).toHaveBeenCalledWith(
      "7::panel-1",
      "navigate_search:next"
    );
    expect(fakeAddon.performTerminalBindingAction).toHaveBeenCalledWith(
      "7::panel-1",
      "navigate_search:previous"
    );
    expect(fakeAddon.performTerminalBindingAction).toHaveBeenCalledWith(
      "7::panel-1",
      "end_search"
    );
  });

  it("rejects invalid terminal search IPC input", async () => {
    const { fakeAddon, invokeHandlers, win } = await setupHarness();
    const oversizedQuery = "x".repeat(513);

    await expect(
      invokeHandlers.get("pier:terminal:search")?.(
        { sender: win.webContents },
        "",
        "needle"
      )
    ).resolves.toEqual({ ok: false, error: "invalid panel id" });
    await expect(
      invokeHandlers.get("pier:terminal:search")?.(
        { sender: win.webContents },
        "panel-1",
        oversizedQuery
      )
    ).resolves.toEqual({ ok: false, error: "invalid search query" });
    await expect(
      invokeHandlers.get("pier:terminal:navigate-search")?.(
        { sender: win.webContents },
        "panel-1",
        "sideways"
      )
    ).resolves.toEqual({ ok: false, error: "invalid search direction" });

    expect(fakeAddon.performTerminalBindingAction).not.toHaveBeenCalled();
  });

  it("forwards native terminal search state to the owning renderer window", async () => {
    const { fakeAddon, win } = await setupHarness();
    const callback = fakeAddon.setSearchForwardCallback.mock.calls[0]?.[0];
    if (!callback) {
      throw new Error("missing search forward callback");
    }

    callback(7, "7::panel-1", 3, 1);

    expect(win.webContents.send).toHaveBeenCalledWith(
      "pier:terminal:search-state",
      { panelId: "panel-1", selected: 1, total: 3 }
    );
  });
});
