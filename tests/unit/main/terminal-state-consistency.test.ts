import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Main 原子 terminal host state 的一致性保护。通过 IPC handler 驱动并观察
 * NativeAddon 调用，锁定 Web/terminal owner、窗口焦点、资源作用域与校验边界。
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
      applyTerminalWindowState: vi.fn(() => ({ status: "applied" })),
      applyTerminalTheme: vi.fn(),
      closeAllTerminals: vi.fn(),
      closeTerminal: vi.fn(),
      createTerminal: vi.fn(() => true),
      detachWindow: vi.fn(),
      performTerminalBindingAction: vi.fn(() => true),
      reconcileTerminals: vi.fn(),
      setKeyboardForwardCallback: vi.fn(),
      setModifierForwardCallback: vi.fn(),
      setMouseForwardCallback: vi.fn(),
      setPwdForwardCallback: vi.fn(),
      setSearchForwardCallback: vi.fn(),
      setTerminalConfig: vi.fn(),
      setTerminalFocusRequestCallback: vi.fn(),
      setTerminalFont: vi.fn(),
      setTitleForwardCallback: vi.fn(),
      setOpenUrlForwardCallback: vi.fn(),
      setupWindow: vi.fn(),
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
      basePanel: { kind: "terminal" as const, panelId },
      hasMaximizedGroup: false,
      reason: "dockview-active-panel" as const,
      rendererSequence,
      terminals: [
        {
          frame: { height: 400, width: 300, x: 0, y: 0 },
          panelId,
          visible: true,
        },
      ],
      webOverlayRects: [],
      webRequestCount: 0,
    };
  }

  it("delegates Web keyboard focus to webContents", async () => {
    const { handlers, win } = await setupHarness();

    handlers.get("pier:terminal:apply-host-snapshot")?.(
      { sender: win.webContents },
      {
        activePanelId: "web-1",
        activeTerminalPanelId: null,
        basePanel: { kind: "web" },
        hasMaximizedGroup: false,
        reason: "input-routing",
        rendererSequence: 1,
        terminals: [],
        webOverlayRects: [],
        webRequestCount: 0,
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

    handlers.get("pier:terminal:apply-host-snapshot")?.(
      { sender: win.webContents },
      terminalPresentation("panel-1")
    );

    expect(fakeAddon.applyTerminalWindowState).toHaveBeenCalledWith(
      Buffer.from("window"),
      expect.objectContaining({
        keyboardTarget: { kind: "web" },
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

  it("applies Web and terminal keyboard targets through atomic host snapshots", async () => {
    const { fakeAddon, handlers, invokeHandlers, win } = await setupHarness();
    await invokeHandlers.get("pier:terminal:create")?.(
      { sender: win.webContents },
      {
        font: { family: "Menlo", size: 13 },
        frame: { height: 400, width: 300, x: 0, y: 0 },
        panelId: "panel-1",
      }
    );

    handlers.get("pier:terminal:apply-host-snapshot")?.(
      { sender: win.webContents },
      {
        ...terminalPresentation("panel-1", 2),
        activePanelId: "web-1",
        activeTerminalPanelId: null,
        basePanel: { kind: "web" },
        reason: "input-routing",
        webOverlayRects: [
          { frame: { height: 400, width: 300, x: 0, y: 0 }, id: "dialog" },
        ],
      }
    );
    expect(fakeAddon.applyTerminalWindowState).toHaveBeenLastCalledWith(
      Buffer.from("window"),
      expect.objectContaining({
        keyboardTarget: { kind: "web" },
        webOverlayRects: [
          { frame: { height: 400, width: 300, x: 0, y: 0 }, id: "dialog" },
        ],
      })
    );

    handlers.get("pier:terminal:apply-host-snapshot")?.(
      { sender: win.webContents },
      terminalPresentation("panel-1", 3)
    );
    expect(fakeAddon.applyTerminalWindowState).toHaveBeenLastCalledWith(
      Buffer.from("window"),
      expect.objectContaining({
        keyboardTarget: { kind: "terminal", panelId: "7::panel-1" },
        webOverlayRects: [],
      })
    );
  });

  it("does not refocus WebContents when only Web overlay rects change", async () => {
    const { handlers, win } = await setupHarness();
    const webSnapshot = {
      activePanelId: "web-1",
      activeTerminalPanelId: null,
      basePanel: { kind: "web" },
      hasMaximizedGroup: false,
      reason: "input-routing",
      rendererSequence: 1,
      terminals: [],
      webOverlayRects: [
        { frame: { height: 24, width: 200, x: 10, y: 10 }, id: "search" },
      ],
      webRequestCount: 0,
    };
    handlers.get("pier:terminal:apply-host-snapshot")?.(
      { sender: win.webContents },
      webSnapshot
    );
    expect(win.webContents.focus).toHaveBeenCalledOnce();

    vi.mocked(win.webContents.focus).mockClear();
    handlers.get("pier:terminal:apply-host-snapshot")?.(
      { sender: win.webContents },
      {
        ...webSnapshot,
        rendererSequence: 2,
        webOverlayRects: [
          { frame: { height: 24, width: 240, x: 10, y: 10 }, id: "search" },
        ],
      }
    );

    expect(win.webContents.focus).not.toHaveBeenCalled();
  });

  it("rejects invalid host snapshots before native or Web focus side effects", async () => {
    const { fakeAddon, handlers, win } = await setupHarness();
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const invalidSnapshots: unknown[] = [
      {},
      {
        activePanelId: "web-1",
        activeTerminalPanelId: null,
        basePanel: { kind: "web" },
        hasMaximizedGroup: false,
        reason: "input-routing",
        rendererSequence: 1,
        terminals: [],
        webOverlayRects: [],
        webRequestCount: -1,
      },
      {
        ...terminalPresentation("panel-1"),
        activePanelId: "web-1",
      },
    ];

    try {
      for (const snapshot of invalidSnapshots) {
        fakeAddon.applyTerminalWindowState.mockClear();
        vi.mocked(win.webContents.focus).mockClear();
        handlers.get("pier:terminal:apply-host-snapshot")?.(
          { sender: win.webContents },
          snapshot
        );
        expect(fakeAddon.applyTerminalWindowState).not.toHaveBeenCalled();
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
