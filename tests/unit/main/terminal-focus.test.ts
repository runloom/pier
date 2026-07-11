import { beforeEach, describe, expect, it, vi } from "vitest";

describe("terminal focus restoration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function setupTerminalFocusHarness(
    opts: {
      ipcWindowFocused?: boolean;
      launch?: {
        agentId?: "claude";
        command?: string;
        cwd?: string;
        env?: Record<string, string>;
        profileId?: string;
      };
      processEnvironment?: {
        resolve: (request: unknown) => Promise<{ env: Record<string, string> }>;
      };
      savedSession?: unknown;
    } = {}
  ) {
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
      reconcileTerminals: vi.fn(),
      sendText: vi.fn(() => true),
      setFrame: vi.fn(),
      setKeyboardForwardCallback: vi.fn(),
      setModifierForwardCallback: vi.fn(),
      setMouseForwardCallback: vi.fn(),
      setTerminalFocusRequestCallback: vi.fn(),
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
      app: { getPath: vi.fn((k: string) => `/tmp/pier-test-${k}`) },
    }));
    vi.doMock("node:module", () => {
      // fake require 带 .resolve —— loadNativeAddon 会先 resolve 拿绝对路径
      // 再 require(addonPath)，两步都需要工作。
      const fakeRequire = Object.assign(
        vi.fn(() => fakeAddon),
        {
          resolve: vi.fn((p: string) => p),
        }
      );
      return {
        createRequire: vi.fn(() => fakeRequire),
        default: { createRequire: vi.fn(() => fakeRequire) },
      };
    });
    const sessionState = {
      clearTerminalPanelAgent: vi.fn(async () => undefined),
      readTerminalPanelSession: vi.fn(async () =>
        "savedSession" in opts
          ? opts.savedSession
          : {
              context: {
                contextId: "ctx-pier",
                cwd: "/Users/xyz/ABC/pier",
                openedPath: "/Users/xyz/ABC/pier",
                projectRoot: "/Users/xyz/ABC/pier",
                source: "panel",
                updatedAt: 1,
                worktreeKey: "/Users/xyz/ABC/pier",
              },
              updatedAt: "2026-06-24T00:00:00.000Z",
            }
      ),
      flushTerminalSessionState: vi.fn(async () => undefined),
      patchTerminalPanelAgentStatus: vi.fn(async () => false),
      patchTerminalPanelTab: vi.fn(async () => undefined),
      patchTerminalPanelTaskStatus: vi.fn(async () => undefined),
      removeTerminalPanelSession: vi.fn(async () => undefined),
      updateTerminalPanelAgent: vi.fn(async () => undefined),
      updateTerminalPanelAgentResume: vi.fn(async () => true),
      updateTerminalPanelContext: vi.fn(async () => undefined),
      updateTerminalPanelTab: vi.fn(async () => undefined),
      updateTerminalPanelTask: vi.fn(async () => undefined),
      updateTerminalPanelTitle: vi.fn(async () => undefined),
    };
    vi.doMock("@main/state/terminal-session-state.ts", () => sessionState);
    vi.doMock("@main/state/panel-context-state.ts", () => ({
      recordRecentPanelContext: vi.fn(async () => undefined),
    }));
    const consumeLaunch = vi.fn(() => opts.launch ?? null);
    const readLaunch = vi.fn(() => opts.launch ?? null);
    vi.doMock("@main/state/terminal-launch-state.ts", () => ({
      terminalLaunchRegistry: {
        consume: consumeLaunch,
        read: readLaunch,
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
        id === ipcWindow.id ? ipcWindow : null
      ),
      findAppWindowByWebContents: vi.fn(() => ipcWindow),
      findInternalWindowId: vi.fn(() => "main"),
    }));

    const { registerTerminalIpc } = await import("@main/ipc/terminal.ts");
    const { restoreActivePanelFocus } = await import(
      "@main/ipc/terminal-focus-state.ts"
    );

    registerTerminalIpc(
      fakeIpcMain as never,
      opts.processEnvironment
        ? { processEnvironment: opts.processEnvironment as never }
        : undefined
    );
    return {
      consumeLaunch,
      fakeAddon,
      handlers,
      invokeHandlers,
      ipcWindow,
      readLaunch,
      restoreActivePanelFocus,
      restoreWindow,
      sessionState,
    };
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
          frame: { height: 200, width: 300, x: 1, y: 2 },
          panelId,
          visible: true,
        },
      ],
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

    handlers.get("pier:terminal:apply-presentation")?.(
      { sender: ipcWindow.webContents },
      terminalPresentation("panel-1")
    );
    handlers.get("pier:terminal:apply-input-routing")?.(
      { sender: ipcWindow.webContents },
      {
        basePanel: { kind: "terminal", panelId: "panel-1" },
        webRequestCount: 0,
        rendererSequence: 2,
        webOverlayRects: [],
      }
    );
    fakeAddon.applyTerminalPresentation.mockClear();

    restoreActivePanelFocus(restoreWindow as never);

    expect(restoreWindow.focus).toHaveBeenCalledOnce();
    expect(fakeAddon.applyTerminalPresentation).toHaveBeenCalledWith(
      Buffer.from("window"),
      expect.objectContaining({
        activePanelId: "7::panel-1",
        activeTerminalPanelId: "7::panel-1",
        reason: "window-focus",
        terminals: [
          expect.objectContaining({
            focused: true,
            panelId: "7::panel-1",
            visible: true,
          }),
        ],
      })
    );
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

    handlers.get("pier:terminal:apply-presentation")?.(
      { sender: ipcWindow.webContents },
      terminalPresentation("panel-1")
    );
    handlers.get("pier:terminal:apply-input-routing")?.(
      { sender: ipcWindow.webContents },
      {
        basePanel: { kind: "terminal", panelId: "panel-1" },
        webRequestCount: 0,
        rendererSequence: 2,
        webOverlayRects: [],
      }
    );
    fakeAddon.applyTerminalPresentation.mockClear();

    restoreActivePanelFocus(restoreWindow as never);

    expect(restoreWindow.focus).toHaveBeenCalledOnce();
    expect(fakeAddon.applyTerminalPresentation).toHaveBeenCalledWith(
      Buffer.from("window"),
      expect.objectContaining({
        activePanelId: "7::panel-1",
        activeTerminalPanelId: "7::panel-1",
        reason: "window-focus",
      })
    );
    expect(restoreWindow.webContents.focus).not.toHaveBeenCalled();
  });

  it("records but does not focus a terminal panel while its window is blurred", async () => {
    const { fakeAddon, handlers, ipcWindow } = await setupTerminalFocusHarness({
      ipcWindowFocused: false,
    });

    handlers.get("pier:terminal:apply-presentation")?.(
      { sender: ipcWindow.webContents },
      terminalPresentation("panel-1")
    );

    expect(fakeAddon.applyTerminalInputRouting).toHaveBeenCalledWith(
      Buffer.from("window"),
      expect.objectContaining({
        basePanel: { kind: "web" },
        windowFocused: false,
      })
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
  });

  it("forwards native terminal focus requests to source window renderer (unscoped panelId)", async () => {
    // swift 端 forward callback 传的是 scoped panelId (因为 createTerminal 时
    // main 用 scoped key 写进了 swift terminals dict), main 必须 unscope 后给 renderer
    // — React/dockview 的 panel id 是 raw.
    const { fakeAddon, ipcWindow } = await setupTerminalFocusHarness();
    const focusForward =
      fakeAddon.setTerminalFocusRequestCallback.mock.calls[0]?.[0];
    fakeAddon.applyTerminalInputRouting.mockClear();

    focusForward?.(ipcWindow.id, "7::panel-2");

    expect(fakeAddon.applyTerminalInputRouting).not.toHaveBeenCalled();
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
      {
        cwd: "/Users/xyz/ABC/pier",
        env: expect.objectContaining({
          PIER_PANEL_ID: "terminal-1",
          PIER_WINDOW_ID: "7",
        }),
      },
      ""
    );
  });

  it("records agent state before native create without persisting launch env", async () => {
    const { fakeAddon, invokeHandlers, ipcWindow, sessionState } =
      await setupTerminalFocusHarness({
        launch: {
          agentId: "claude",
          command: "claude",
          cwd: "/repo",
          env: { OPENAI_API_KEY: "sk-secret" },
        },
        savedSession: null,
      });

    const result = await invokeHandlers.get("pier:terminal:create")?.(
      { sender: ipcWindow.webContents },
      {
        font: { family: "Menlo", size: 13 },
        frame: { x: 1, y: 2, width: 300, height: 200 },
        launchId: "launch-agent",
        panelId: "terminal-1",
      }
    );

    expect(result).toEqual({ ok: true });
    expect(sessionState.updateTerminalPanelAgent).toHaveBeenCalledWith(
      "main",
      "terminal-1",
      expect.objectContaining({
        agentId: "claude",
        launch: {
          agentId: "claude",
          command: "claude",
          cwd: "/repo",
        },
      })
    );
    expect(sessionState.updateTerminalPanelAgent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        launch: expect.objectContaining({
          env: expect.anything(),
        }),
      })
    );
    const persistOrder =
      sessionState.updateTerminalPanelAgent.mock.invocationCallOrder[0];
    const createOrder = fakeAddon.createTerminal.mock.invocationCallOrder[0];
    if (persistOrder === undefined || createOrder === undefined) {
      throw new Error("expected persist and create calls");
    }
    expect(persistOrder).toBeLessThan(createOrder);
  });

  it("re-resolves env for restored running agents without saving it", async () => {
    const processEnvironment = {
      resolve: vi.fn(async () => ({
        env: { OPENAI_API_KEY: "sk-restored" },
      })),
    };
    const { fakeAddon, invokeHandlers, ipcWindow, sessionState } =
      await setupTerminalFocusHarness({
        processEnvironment,
        savedSession: {
          agent: {
            agentId: "claude",
            launch: {
              agentId: "claude",
              command: "claude",
              cwd: "/repo",
            },
            startedAt: 1_772_000_000_000,
            status: "running",
          },
          context: {
            contextId: "ctx:/repo",
            cwd: "/repo",
            projectRootPath: "/repo",
            source: "panel",
            updatedAt: 1,
          },
          updatedAt: "2026-07-06T00:00:00.000Z",
        },
      });

    const result = await invokeHandlers.get("pier:terminal:create")?.(
      { sender: ipcWindow.webContents },
      {
        font: { family: "Menlo", size: 13 },
        frame: { x: 1, y: 2, width: 300, height: 200 },
        panelId: "terminal-1",
      }
    );

    expect(result).toEqual({ ok: true });
    expect(processEnvironment.resolve).toHaveBeenCalledWith({
      cwd: "/repo",
      source: "agent",
    });
    expect(fakeAddon.createTerminal).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        env: expect.objectContaining({
          OPENAI_API_KEY: "sk-restored",
        }),
      }),
      ""
    );
    expect(sessionState.updateTerminalPanelAgent).toHaveBeenCalledWith(
      "main",
      "terminal-1",
      expect.objectContaining({
        launch: {
          agentId: "claude",
          command: "claude",
          cwd: "/repo",
        },
      })
    );
  });

  it("uses resume adapter for restored running agents with hook session ids", async () => {
    const { fakeAddon, invokeHandlers, ipcWindow, sessionState } =
      await setupTerminalFocusHarness({
        savedSession: {
          agent: {
            agentId: "claude",
            launch: {
              agentId: "claude",
              command: "claude --dangerously-skip-permissions",
              cwd: "/repo",
            },
            resume: {
              capturedAt: 1_772_000_001_000,
              sessionId: "session-123",
              source: "hook",
            },
            startedAt: 1_772_000_000_000,
            status: "running",
          },
          context: {
            contextId: "ctx:/repo",
            cwd: "/repo",
            projectRootPath: "/repo",
            source: "panel",
            updatedAt: 1,
          },
          updatedAt: "2026-07-06T00:00:00.000Z",
        },
      });

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
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        command: "claude --dangerously-skip-permissions --resume session-123",
      }),
      ""
    );
    expect(sessionState.updateTerminalPanelAgent).toHaveBeenCalledWith(
      "main",
      "terminal-1",
      expect.objectContaining({
        launch: {
          agentId: "claude",
          command: "claude --dangerously-skip-permissions",
          cwd: "/repo",
        },
        resume: {
          capturedAt: 1_772_000_001_000,
          sessionId: "session-123",
          source: "hook",
        },
      })
    );
  });

  it("sends initial input to the scoped native terminal after creation", async () => {
    const { fakeAddon, invokeHandlers, ipcWindow } =
      await setupTerminalFocusHarness();

    const result = await invokeHandlers.get("pier:terminal:create")?.(
      { sender: ipcWindow.webContents },
      {
        font: { family: "Menlo", size: 13 },
        frame: { x: 1, y: 2, width: 300, height: 200 },
        initialInput: "修复终端焦点问题\r",
        panelId: "terminal-1",
      }
    );

    expect(result).toEqual({ ok: true });
    expect(fakeAddon.sendText).toHaveBeenCalledWith(
      "7::terminal-1",
      "修复终端焦点问题\r"
    );
  });

  it("prefers a saved context over a stale renderer-provided initial context", async () => {
    const { fakeAddon, invokeHandlers, ipcWindow } =
      await setupTerminalFocusHarness();
    const staleContext = {
      contextId: "ctx-original-open",
      cwd: "/Users/xyz/ABC/original-open",
      openedPath: "/Users/xyz/ABC/original-open",
      projectRoot: "/Users/xyz/ABC/original-open",
      source: "command" as const,
      updatedAt: 1,
      worktreeKey: "/Users/xyz/ABC/original-open",
    };

    const result = await invokeHandlers.get("pier:terminal:create")?.(
      { sender: ipcWindow.webContents },
      {
        context: staleContext,
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
      {
        cwd: "/Users/xyz/ABC/pier",
        env: expect.objectContaining({
          PIER_PANEL_ID: "terminal-1",
          PIER_WINDOW_ID: "7",
        }),
      },
      ""
    );
  });

  // #41 (task rerun): launchId 仍在 registry = 用户显式发起的新 launch,
  // 即使同 panel 已有保存会话也要重放 command/env (rerun 复用同一 panel)。
  it("replays launch command/env when the launchId still resolves (task rerun)", async () => {
    const { consumeLaunch, fakeAddon, invokeHandlers, ipcWindow } =
      await setupTerminalFocusHarness({
        launch: {
          command: "pnpm test",
          cwd: "/Users/xyz/ABC/stale-launch",
          env: { SECRET: "token" },
          profileId: "codex",
        },
      });

    const result = await invokeHandlers.get("pier:terminal:create")?.(
      { sender: ipcWindow.webContents },
      {
        font: { family: "Menlo", size: 13 },
        frame: { x: 1, y: 2, width: 300, height: 200 },
        launchId: "launch-rerun",
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
      {
        command: "pnpm test",
        cwd: "/Users/xyz/ABC/pier",
        env: expect.objectContaining({
          PIER_PANEL_ID: "terminal-1",
          PIER_WINDOW_ID: "7",
          SECRET: "token",
        }),
      },
      ""
    );
    expect(consumeLaunch).toHaveBeenCalledWith("launch-rerun");
  });

  // 一次性 launch 已被 consume (或 app 重启后 in-memory registry 清空) 时,
  // 携带陈旧 launchId 的重建绝不能重放 command/env — 只还原 cwd。
  it("does not replay a consumed one-shot launch on session restore", async () => {
    const { fakeAddon, invokeHandlers, ipcWindow } =
      await setupTerminalFocusHarness();

    const result = await invokeHandlers.get("pier:terminal:create")?.(
      { sender: ipcWindow.webContents },
      {
        font: { family: "Menlo", size: 13 },
        frame: { x: 1, y: 2, width: 300, height: 200 },
        launchId: "launch-restore",
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
      {
        cwd: "/Users/xyz/ABC/pier",
        env: expect.objectContaining({
          PIER_PANEL_ID: "terminal-1",
          PIER_WINDOW_ID: "7",
        }),
      },
      ""
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
    const { blurActivePanelFocus } = await import(
      "@main/ipc/terminal-focus-state.ts"
    );

    handlers.get("pier:terminal:apply-presentation")?.(
      { sender: ipcWindow.webContents },
      terminalPresentation("panel-1")
    );
    fakeAddon.applyTerminalPresentation.mockClear();

    blurActivePanelFocus(ipcWindow as never);

    expect(fakeAddon.applyTerminalPresentation).toHaveBeenCalledWith(
      Buffer.from("window"),
      expect.objectContaining({
        activePanelId: "7::panel-1",
        activeTerminalPanelId: "7::panel-1",
        reason: "window-blur",
        terminals: [
          expect.objectContaining({
            focused: false,
            panelId: "7::panel-1",
            visible: true,
          }),
        ],
      })
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

    handlers.get("pier:terminal:apply-input-routing")?.(
      { sender: ipcWindow.webContents },
      {
        basePanel: { kind: "terminal", panelId: "panel-1" },
        webRequestCount: 0,
        rendererSequence: 1,
        webOverlayRects: [],
      }
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
    const { blurActivePanelFocus } = await import(
      "@main/ipc/terminal-focus-state.ts"
    );

    expect(() => blurActivePanelFocus(destroyedWindow as never)).not.toThrow();
  });
});
