import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 多窗口 panel id 隔离 — 防 #16/#30 回归.
 *
 * Pier 默认 layout 多窗口都用 "terminal-1", 不加 window scope 时 swift 端
 * `terminals: [String: Terminal]` 单一 dict 会撞:
 *   - w1 createTerminal("terminal-1") → terminals["terminal-1"] = w1.term
 *   - w2 createTerminal("terminal-1") → existing.parentWindow !== w2 → close(w1.term)
 *     → 创建 w2.term. **w1 的 panel NSView 被关掉了**, 用户看 w1 panel 空白.
 *
 * 修法:main 端给 IPC 上行 panelId 加 `${win.id}::` 前缀, 下行 forward 时 unscope.
 * swift 透明用 scoped id 做 dict key, 不同窗口的 panel 自然隔离.
 *
 * 这条文件锁住核心 invariant:
 * 1. 同一 IPC 在不同 win.id 下传给 addon 的 panelId 必须带不同 scope
 * 2. Swift forward 时 main unscope 后给 renderer (renderer/dockview 用 raw id)
 */
describe("multi-window panel id scoping (#16 #30)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function setupHarness(
    winId: number,
    opts: {
      launch?: {
        command?: string;
        cwd?: string;
        env?: Record<string, string>;
        profileId?: string;
      };
    } = {}
  ) {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const invokeHandlers = new Map<
      string,
      (...args: unknown[]) => unknown | Promise<unknown>
    >();
    const fakeAddon = {
      applyTerminalWindowState: vi.fn(() => ({ status: "applied" })),
      applyTerminalTheme: vi.fn(),
      closeAllTerminals: vi.fn(),
      closeTerminal: vi.fn(),
      createTerminal: vi.fn(() => true),
      detachWindow: vi.fn(),
      reconcileTerminals: vi.fn(),
      setKeyboardForwardCallback: vi.fn(),
      setModifierForwardCallback: vi.fn(),
      setMouseForwardCallback: vi.fn(),
      setPwdForwardCallback: vi.fn(),
      setTerminalFocusRequestCallback: vi.fn(),
      setTerminalFont: vi.fn(),
      setTitleForwardCallback: vi.fn(),
      setOpenUrlForwardCallback: vi.fn(),
      setupWindow: vi.fn(),
    };
    const win = {
      focus: vi.fn(),
      getNativeWindowHandle: () => Buffer.from(`win-${winId}`),
      id: winId,
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
      patchTerminalPanelAgentStatus: vi.fn(async () => false),
      patchTerminalPanelTab: vi.fn(async () => undefined),
      patchTerminalPanelTaskStatus: vi.fn(async () => true),
      readTerminalPanelSession: vi.fn(async () => null),
      removeTerminalPanelSession: vi.fn(async () => undefined),
      retainTerminalPanelSessions: vi.fn(async () => undefined),
      updateTerminalPanelAgent: vi.fn(async () => undefined),
      updateTerminalPanelAgentResume: vi.fn(async () => true),
      updateTerminalPanelContext: vi.fn(async () => undefined),
      updateTerminalPanelTitle: vi.fn(async () => undefined),
    }));
    vi.doMock("@main/state/panel-context-state.ts", () => ({
      recordRecentPanelContext: vi.fn(async () => undefined),
    }));
    const consumeLaunch = vi.fn(() => opts.launch ?? null);
    vi.doMock("@main/state/terminal-launch-state.ts", () => ({
      terminalLaunchRegistry: {
        consume: consumeLaunch,
        read: vi.fn(() => opts.launch ?? null),
        register: vi.fn(),
      },
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
      findInternalWindowId: vi.fn(() => `w${winId}`),
      findWindowContext: vi.fn(() => ({
        electronWindowId: String(win.id),
        mode: "restore" as const,
        recordId: `w${winId}`,
        windowId: `w${winId}`,
      })),
    }));

    const { registerTerminalIpc } = await import("@main/ipc/terminal.ts");
    registerTerminalIpc(fakeIpcMain as never, {
      loadNativeAddon: () => ({ addon: fakeAddon as never, error: null }),
    });

    return { consumeLaunch, fakeAddon, handlers, invokeHandlers, win };
  }

  it("two windows with same raw panel id produce distinct scoped ids on addon calls", async () => {
    // 模拟 Pier 默认 layout 的真实场景:两个 BrowserWindow 都 createTerminal("terminal-1").
    // 修复后 addon.createTerminal 收到的 panelId 必须带 win.id scope, 不会撞 dict key.
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const invokeHandlers = new Map<
      string,
      (...args: unknown[]) => unknown | Promise<unknown>
    >();
    const fakeAddon = {
      applyTerminalInputRouting: vi.fn(),
      applyTerminalPresentation: vi.fn(),
      applyTerminalTheme: vi.fn(),
      closeAllTerminals: vi.fn(),
      closeTerminal: vi.fn(),
      createTerminal: vi.fn(() => true),
      detachWindow: vi.fn(),
      reconcileTerminals: vi.fn(),
      setKeyboardForwardCallback: vi.fn(),
      setModifierForwardCallback: vi.fn(),
      setMouseForwardCallback: vi.fn(),
      setPwdForwardCallback: vi.fn(),
      setTerminalFocusRequestCallback: vi.fn(),
      setTerminalFont: vi.fn(),
      setTitleForwardCallback: vi.fn(),
      setOpenUrlForwardCallback: vi.fn(),
      setupWindow: vi.fn(),
    };
    const makeWin = (id: number) => ({
      focus: vi.fn(),
      getNativeWindowHandle: () => Buffer.from(`win-${id}`),
      id,
      isDestroyed: () => false,
      isFocused: () => true,
      isMinimized: () => false,
      restore: vi.fn(),
      webContents: {
        focus: vi.fn(),
        isDestroyed: () => false,
        send: vi.fn(),
      },
    });
    const w1 = makeWin(1);
    const w2 = makeWin(2);

    const idMap = new Map([
      [1, w1],
      [2, w2],
    ]);
    const wcMap = new Map<unknown, typeof w1>([
      [w1.webContents, w1],
      [w2.webContents, w2],
    ]);
    vi.doMock("electron", () => ({
      app: { getPath: vi.fn((k: string) => `/tmp/pier-test-${k}`) },
    }));
    vi.doMock("@main/state/terminal-session-state.ts", () => ({
      clearTerminalPanelAgent: vi.fn(async () => undefined),
      ensureTerminalPanelSession: vi.fn(async () => undefined),
      patchTerminalPanelAgentStatus: vi.fn(async () => false),
      patchTerminalPanelTab: vi.fn(async () => undefined),
      patchTerminalPanelTaskStatus: vi.fn(async () => true),
      readTerminalPanelSession: vi.fn(async () => null),
      removeTerminalPanelSession: vi.fn(async () => undefined),
      retainTerminalPanelSessions: vi.fn(async () => undefined),
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
      findAppWindowByElectronId: vi.fn((id: number) => idMap.get(id) ?? null),
      // 按 webContents 反查:每个 sender 是不同 webContents 对象, 路由对应 window.
      findAppWindowByWebContents: vi.fn((wc: unknown) => wcMap.get(wc) ?? null),
      findInternalWindowId: vi.fn(() => "main"),
      findWindowContext: vi.fn(() => ({
        mode: "restore" as const,
        recordId: "main",
        windowId: "main",
      })),
    }));

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

    const { registerTerminalIpc } = await import("@main/ipc/terminal.ts");
    registerTerminalIpc(fakeIpcMain as never, {
      loadNativeAddon: () => ({ addon: fakeAddon as never, error: null }),
    });

    await invokeHandlers.get("pier:terminal:create")?.(
      { sender: w1.webContents },
      {
        font: { family: "Menlo", size: 13 },
        frame: { x: 0, y: 0, width: 800, height: 600 },
        panelId: "terminal-1",
      }
    );
    await invokeHandlers.get("pier:terminal:create")?.(
      { sender: w2.webContents },
      {
        font: { family: "Menlo", size: 13 },
        frame: { x: 0, y: 0, width: 800, height: 600 },
        panelId: "terminal-1",
      }
    );

    expect(fakeAddon.createTerminal).toHaveBeenCalledTimes(2);
    expect(fakeAddon.createTerminal).toHaveBeenNthCalledWith(
      1,
      Buffer.from("win-1"),
      "1::terminal-1",
      expect.any(Object),
      "Menlo",
      13,
      {
        env: expect.objectContaining({
          PIER_PANEL_ID: "terminal-1",
          PIER_WINDOW_ID: "1",
        }),
      },
      ""
    );
    expect(fakeAddon.createTerminal).toHaveBeenNthCalledWith(
      2,
      Buffer.from("win-2"),
      "2::terminal-1",
      expect.any(Object),
      "Menlo",
      13,
      {
        env: expect.objectContaining({
          PIER_PANEL_ID: "terminal-1",
          PIER_WINDOW_ID: "2",
        }),
      },
      ""
    );
  });

  it("scopes atomic host state, create, and close panel ids", async () => {
    const { fakeAddon, handlers, invokeHandlers, win } = await setupHarness(7);
    await invokeHandlers.get("pier:terminal:create")?.(
      { sender: win.webContents },
      {
        font: { family: "Menlo", size: 13 },
        frame: { x: 0, y: 0, width: 1, height: 1 },
        panelId: "panel-a",
      }
    );
    handlers.get("pier:terminal:apply-host-snapshot")?.(
      { sender: win.webContents },
      {
        activePanelId: "panel-a",
        activeTerminalPanelId: "panel-a",
        basePanel: { kind: "terminal", panelId: "panel-a" },
        focusDisabledPanelIds: [],
        hasMaximizedGroup: false,
        reason: "dockview-active-panel",
        rendererSequence: 1,
        terminals: [
          {
            frame: { x: 0, y: 0, width: 1, height: 1 },
            panelId: "panel-a",
            visible: true,
          },
        ],
        webOverlayRects: [],
        webRequestCount: 0,
      }
    );
    await invokeHandlers.get("pier:terminal:close")?.(
      { sender: win.webContents },
      "panel-a"
    );

    expect(fakeAddon.applyTerminalWindowState).toHaveBeenCalledWith(
      Buffer.from("win-7"),
      expect.objectContaining({
        keyboardTarget: { kind: "terminal", panelId: "7::panel-a" },
      })
    );
    expect(fakeAddon.closeTerminal).toHaveBeenCalledWith("7::panel-a");
    expect(fakeAddon.createTerminal).toHaveBeenCalledWith(
      Buffer.from("win-7"),
      "7::panel-a",
      expect.any(Object),
      "Menlo",
      13,
      {
        env: expect.objectContaining({
          PIER_PANEL_ID: "panel-a",
          PIER_WINDOW_ID: "7",
        }),
      },
      ""
    );
  });

  it("passes registered launch options into native terminal creation", async () => {
    const launch = {
      command: "pnpm test",
      cwd: "/tmp/pier",
      env: { PIER_MODE: "dev" },
      profileId: "codex",
    };
    const { consumeLaunch, fakeAddon, invokeHandlers, win } =
      await setupHarness(7, { launch });

    const result = await invokeHandlers.get("pier:terminal:create")?.(
      { sender: win.webContents },
      {
        font: { family: "Menlo", size: 13 },
        frame: { x: 0, y: 0, width: 1, height: 1 },
        launchId: "launch-1",
        panelId: "panel-a",
      }
    );

    expect(result).toEqual({ ok: true });
    expect(fakeAddon.createTerminal).toHaveBeenCalledWith(
      Buffer.from("win-7"),
      "7::panel-a",
      expect.any(Object),
      "Menlo",
      13,
      {
        command: "pnpm test",
        cwd: "/tmp/pier",
        env: expect.objectContaining({
          PIER_MODE: "dev",
          PIER_PANEL_ID: "panel-a",
          PIER_WINDOW_ID: "7",
        }),
      },
      ""
    );
    expect(consumeLaunch).toHaveBeenCalledWith("launch-1");
  });

  it("reconcile scopes every panelId in the active list (no cross-window orphan close)", async () => {
    // 关键防护:reconcile 集合用来清孤儿 NSView. 不 scope 时 w1 reconcile ["terminal-1"]
    // 会让 swift 把 w2.terminals["terminal-1"] 误识别为 "也在", 但 swift 内部 filter
    // 时用 parentWindow == w1, 不影响 w2; 反过来 swift 用 scoped key 后, w1
    // reconcile ["terminal-1"] 给 swift 的 active 集合是 ["1::terminal-1"],
    // 完全不会跟 w2 的 ["2::terminal-1"] 重叠 — 双层保险.
    const { fakeAddon, handlers, win } = await setupHarness(3);

    handlers.get("pier:terminal:reconcile")?.({ sender: win.webContents }, [
      "terminal-1",
      "terminal-2",
    ]);

    expect(fakeAddon.reconcileTerminals).toHaveBeenCalledWith(
      Buffer.from("win-3"),
      ["3::terminal-1", "3::terminal-2"]
    );
  });

  it("all forward callbacks unscope before sending to renderer (raw id matches dockview)", async () => {
    // Swift forward 传 scoped panelId (因为 swift 内部 dict key 是 scoped), main 必须
    // unscope 后给 renderer. 缺这条 React 端收到 "1::terminal-1" 但 dockview state
    // 用 "terminal-1", 事件 filter (`req.panelId !== panelId`) 永远不命中, 全部 drop.
    const { fakeAddon, handlers, win } = await setupHarness(5);
    const mouseFwd = fakeAddon.setMouseForwardCallback.mock.calls[0]?.[0];
    const focusFwd =
      fakeAddon.setTerminalFocusRequestCallback.mock.calls[0]?.[0];
    const pwdFwd = fakeAddon.setPwdForwardCallback.mock.calls[0]?.[0];
    const titleFwd = fakeAddon.setTitleForwardCallback.mock.calls[0]?.[0];
    const { terminalFocusCoordinator } = await import(
      "@main/ipc/terminal-focus-coordinator.ts"
    );
    handlers.get("pier:terminal:apply-host-snapshot")?.(
      { sender: win.webContents },
      {
        activePanelId: "terminal-3",
        activeTerminalPanelId: "terminal-3",
        basePanel: { kind: "terminal", panelId: "terminal-3" },
        focusDisabledPanelIds: [],
        hasMaximizedGroup: false,
        reason: "dockview-active-panel",
        rendererSequence: 1,
        terminals: [
          {
            frame: { height: 100, width: 100, x: 0, y: 0 },
            panelId: "terminal-3",
            visible: true,
          },
        ],
        webOverlayRects: [],
        webRequestCount: 0,
      }
    );
    terminalFocusCoordinator.surfaceCreated(win as never, "terminal-3");

    mouseFwd?.(win.id, "5::terminal-2", 100, 200);
    focusFwd?.(win.id, "5::terminal-3");
    pwdFwd?.(win.id, "5::terminal-4", "/some/path");
    titleFwd?.(win.id, "5::terminal-5", "", "My Terminal");

    await new Promise((resolve) => setImmediate(resolve));

    expect(win.webContents.send).toHaveBeenCalledWith(
      "pier:terminal:request-context-menu",
      { panelId: "terminal-2", x: 100, y: 200 }
    );
    expect(win.webContents.send).toHaveBeenCalledWith(
      "pier:terminal:focus-request",
      { panelId: "terminal-3" }
    );
    expect(win.webContents.send).toHaveBeenCalledWith(
      "pier://terminal:cwd-changed",
      {
        context: expect.objectContaining({ cwd: "/some/path" }),
        panelId: "terminal-4",
      }
    );
    expect(win.webContents.send).toHaveBeenCalledWith(
      "pier://terminal:title-changed",
      { panelId: "terminal-5", title: "My Terminal" }
    );
  });

  it("rejects unscoped native focus intents", async () => {
    const { fakeAddon, win } = await setupHarness(9);
    const focusFwd =
      fakeAddon.setTerminalFocusRequestCallback.mock.calls[0]?.[0];

    focusFwd?.(win.id, "legacy-no-scope");

    expect(win.webContents.send).not.toHaveBeenCalledWith(
      "pier:terminal:focus-request",
      expect.anything()
    );
  });
});
