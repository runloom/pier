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
      applyTerminalWindowState: vi.fn(() => ({ status: "applied" })),
      applyTerminalInputRouting: vi.fn(),
      applyTerminalPresentation: vi.fn(),
      applyTerminalTheme: vi.fn(),
      closeAllTerminals: vi.fn(),
      closeTerminal: vi.fn(),
      createTerminal: vi.fn(() => true),
      detachWindow: vi.fn(),
      reconcileTerminals: vi.fn(),
      sendText: vi.fn(() => true),
      setKeyboardForwardCallback: vi.fn(),
      setModifierForwardCallback: vi.fn(),
      setMouseForwardCallback: vi.fn(),
      setTerminalFocusRequestCallback: vi.fn(),
      setPwdForwardCallback: vi.fn(),
      setTerminalFont: vi.fn(),
      setTitleForwardCallback: vi.fn(),
      setOpenUrlForwardCallback: vi.fn(),
      setupWindow: vi.fn(() => true),
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
    const sessionState = {
      clearTerminalPanelAgent: vi.fn(async () => undefined),
      ensureTerminalPanelSession: vi.fn(async () => undefined),
      readTerminalPanelSession: vi.fn(async () =>
        "savedSession" in opts
          ? opts.savedSession
          : {
              context: {
                contextId: "ctx-pier",
                cwd: "/Users/dev/ABC/pier",
                openedPath: "/Users/dev/ABC/pier",
                projectRoot: "/Users/dev/ABC/pier",
                source: "panel",
                updatedAt: 1,
                worktreeKey: "/Users/dev/ABC/pier",
              },
              updatedAt: "2026-06-24T00:00:00.000Z",
            }
      ),
      flushTerminalSessionState: vi.fn(async () => undefined),
      patchTerminalPanelAgentStatus: vi.fn(async () => false),
      patchTerminalPanelTab: vi.fn(async () => undefined),
      patchTerminalPanelTaskStatus: vi.fn(async () => undefined),
      removeTerminalPanelSession: vi.fn(async () => undefined),
      retainTerminalPanelSessions: vi.fn(async () => undefined),
      updateTerminalPanelAgent: vi.fn(
        async (
          _windowId: number,
          _panelId: string,
          _agent: { launch?: { command?: string } } | null
        ) => undefined
      ),
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
      findWindowContext: vi.fn(() => ({
        electronWindowId: String(ipcWindow.id),
        mode: "restore" as const,
        recordId: "main",
        windowId: "main",
      })),
    }));

    const { registerTerminalIpc } = await import("@main/ipc/terminal.ts");
    const { terminalFocusCoordinator } = await import(
      "@main/ipc/terminal-focus-coordinator.ts"
    );

    registerTerminalIpc(fakeIpcMain as never, {
      loadNativeAddon: () => ({ addon: fakeAddon as never, error: null }),
      ...(opts.processEnvironment
        ? { processEnvironment: opts.processEnvironment as never }
        : {}),
    });
    return {
      terminalFocusCoordinator,
      consumeLaunch,
      fakeAddon,
      handlers,
      invokeHandlers,
      ipcWindow,
      readLaunch,
      restoreWindow,
      sessionState,
    };
  }

  function terminalPresentation(panelId = "panel-1", rendererSequence = 1) {
    return {
      activePanelId: panelId,
      activeTerminalPanelId: panelId,
      basePanel: { kind: "terminal" as const, panelId },
      focusDisabledPanelIds: [],
      hasMaximizedGroup: false,
      reason: "dockview-active-panel" as const,
      rendererSequence,
      terminals: [
        {
          frame: { height: 200, width: 300, x: 1, y: 2 },
          panelId,
          visible: true,
        },
      ],
      webOverlayRects: [],
      webRequestCount: 0,
    };
  }

  it("applies the active terminal after its host snapshot and surface are ready", async () => {
    const { fakeAddon, handlers, ipcWindow, terminalFocusCoordinator } =
      await setupTerminalFocusHarness();

    handlers.get("pier:terminal:apply-host-snapshot")?.(
      { sender: ipcWindow.webContents },
      terminalPresentation("panel-1")
    );
    fakeAddon.applyTerminalWindowState.mockClear();
    ipcWindow.webContents.focus.mockClear();

    terminalFocusCoordinator.surfaceCreated(ipcWindow as never, "panel-1");

    expect(fakeAddon.applyTerminalWindowState).toHaveBeenCalledWith(
      Buffer.from("window"),
      expect.objectContaining({
        keyboardTarget: { kind: "terminal", panelId: "7::panel-1" },
        terminals: [
          expect.objectContaining({
            focused: true,
            panelId: "7::panel-1",
            visible: true,
          }),
        ],
      })
    );
    expect(ipcWindow.webContents.focus).not.toHaveBeenCalled();
  });

  it("repairs native focus while the desired terminal remains unchanged", async () => {
    const {
      fakeAddon,
      handlers,
      ipcWindow,
      restoreWindow,
      terminalFocusCoordinator,
    } = await setupTerminalFocusHarness();
    handlers.get("pier:terminal:apply-host-snapshot")?.(
      { sender: ipcWindow.webContents },
      terminalPresentation("panel-1")
    );
    terminalFocusCoordinator.surfaceCreated(ipcWindow as never, "panel-1");
    fakeAddon.applyTerminalWindowState.mockClear();

    terminalFocusCoordinator.setWindowFocused(
      restoreWindow as never,
      true,
      "window-focus"
    );

    expect(fakeAddon.applyTerminalWindowState).toHaveBeenCalledWith(
      Buffer.from("window"),
      expect.objectContaining({
        keyboardTarget: { kind: "terminal", panelId: "7::panel-1" },
        reason: "window-focus",
      })
    );
    expect(restoreWindow.webContents.focus).not.toHaveBeenCalled();
  });

  it("preserves terminal intent but applies Web while its window is blurred", async () => {
    const { fakeAddon, handlers, ipcWindow, terminalFocusCoordinator } =
      await setupTerminalFocusHarness({ ipcWindowFocused: false });

    handlers.get("pier:terminal:apply-host-snapshot")?.(
      { sender: ipcWindow.webContents },
      terminalPresentation("panel-1")
    );
    terminalFocusCoordinator.surfaceCreated(ipcWindow as never, "panel-1");

    expect(fakeAddon.applyTerminalWindowState).toHaveBeenLastCalledWith(
      Buffer.from("window"),
      expect.objectContaining({
        keyboardTarget: { kind: "web" },
        windowFocused: false,
      })
    );
    expect(
      terminalFocusCoordinator.readDebug(ipcWindow as never).desired?.basePanel
    ).toEqual({
      kind: "terminal",
      panelId: "panel-1",
    });
  });

  it("forwards a valid native terminal focus intent to its source window", async () => {
    const { fakeAddon, handlers, ipcWindow, terminalFocusCoordinator } =
      await setupTerminalFocusHarness();
    handlers.get("pier:terminal:apply-host-snapshot")?.(
      { sender: ipcWindow.webContents },
      terminalPresentation("panel-2")
    );
    terminalFocusCoordinator.surfaceCreated(ipcWindow as never, "panel-2");
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
      {
        cwd: "/Users/dev/ABC/pier",
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
        startedAt: 1_772_000_000_000,
      })
    );
    const persistedAgent =
      sessionState.updateTerminalPanelAgent.mock.calls.at(-1)?.[2];
    expect(persistedAgent?.launch?.command).not.toContain("--resume");
  });

  it("keeps restored agent metadata when native create returns false", async () => {
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
    fakeAddon.createTerminal.mockReturnValueOnce(false);

    const result = await invokeHandlers.get("pier:terminal:create")?.(
      { sender: ipcWindow.webContents },
      {
        font: { family: "Menlo", size: 13 },
        frame: { x: 1, y: 2, width: 300, height: 200 },
        panelId: "terminal-1",
      }
    );

    expect(result).toEqual({
      ok: false,
      error: "createTerminal returned false",
    });
    expect(sessionState.updateTerminalPanelAgent).toHaveBeenCalledWith(
      "main",
      "terminal-1",
      expect.objectContaining({
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
      })
    );
    expect(sessionState.clearTerminalPanelAgent).not.toHaveBeenCalled();
  });

  it("clears agent metadata when a fresh launch create returns false", async () => {
    const { fakeAddon, invokeHandlers, ipcWindow, sessionState } =
      await setupTerminalFocusHarness({
        launch: {
          agentId: "claude",
          command: "claude",
          cwd: "/repo",
        },
        savedSession: null,
      });
    fakeAddon.createTerminal.mockReturnValueOnce(false);

    const result = await invokeHandlers.get("pier:terminal:create")?.(
      { sender: ipcWindow.webContents },
      {
        font: { family: "Menlo", size: 13 },
        frame: { x: 1, y: 2, width: 300, height: 200 },
        launchId: "launch-agent",
        panelId: "terminal-1",
      }
    );

    expect(result).toEqual({
      ok: false,
      error: "createTerminal returned false",
    });
    expect(sessionState.updateTerminalPanelAgent).toHaveBeenCalled();
    expect(sessionState.clearTerminalPanelAgent).toHaveBeenCalledWith(
      "main",
      "terminal-1"
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
    // initial-input-gate 把注入延后到 shell 打完 banner + 首个 prompt 之后。
    // 测试模拟第一次 OSC 7 触发（生产链路是 native shell integration 上报 cwd）。
    const { signalPromptReady } = await import(
      "@main/ipc/terminal-initial-input-gate.ts"
    );
    signalPromptReady("terminal-1");
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
      cwd: "/Users/dev/ABC/original-open",
      openedPath: "/Users/dev/ABC/original-open",
      projectRoot: "/Users/dev/ABC/original-open",
      source: "command" as const,
      updatedAt: 1,
      worktreeKey: "/Users/dev/ABC/original-open",
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
        cwd: "/Users/dev/ABC/pier",
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
          cwd: "/Users/dev/ABC/stale-launch",
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
        cwd: "/Users/dev/ABC/pier",
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
        cwd: "/Users/dev/ABC/pier",
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

  it("blurs native terminal focus without dropping desired intent", async () => {
    const { fakeAddon, handlers, ipcWindow, terminalFocusCoordinator } =
      await setupTerminalFocusHarness();
    handlers.get("pier:terminal:apply-host-snapshot")?.(
      { sender: ipcWindow.webContents },
      terminalPresentation("panel-1")
    );
    terminalFocusCoordinator.surfaceCreated(ipcWindow as never, "panel-1");
    fakeAddon.applyTerminalWindowState.mockClear();

    terminalFocusCoordinator.setWindowFocused(
      ipcWindow as never,
      false,
      "window-blur"
    );

    expect(fakeAddon.applyTerminalWindowState).toHaveBeenCalledWith(
      Buffer.from("window"),
      expect.objectContaining({
        keyboardTarget: { kind: "web" },
        reason: "window-blur",
        terminals: [
          expect.objectContaining({
            focused: false,
            panelId: "7::panel-1",
          }),
        ],
      })
    );
    expect(
      terminalFocusCoordinator.readDebug(ipcWindow as never).desired?.basePanel
    ).toEqual({
      kind: "terminal",
      panelId: "panel-1",
    });
  });

  it("restores, focuses, then reapplies terminal ownership for a minimized window", async () => {
    const { fakeAddon, handlers, ipcWindow, terminalFocusCoordinator } =
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
    handlers.get("pier:terminal:apply-host-snapshot")?.(
      { sender: ipcWindow.webContents },
      terminalPresentation("panel-1")
    );
    terminalFocusCoordinator.surfaceCreated(ipcWindow as never, "panel-1");
    fakeAddon.applyTerminalWindowState.mockClear();

    minimizedWindow.restore();
    minimizedWindow.focus();
    terminalFocusCoordinator.setWindowFocused(
      minimizedWindow as never,
      true,
      "window-focus"
    );

    const restoreOrder =
      minimizedWindow.restore.mock.invocationCallOrder[0] ?? 0;
    const focusOrder = minimizedWindow.focus.mock.invocationCallOrder[0] ?? 0;
    const nativeOrder =
      fakeAddon.applyTerminalWindowState.mock.invocationCallOrder[0] ?? 0;
    expect(focusOrder).toBeGreaterThan(restoreOrder);
    expect(nativeOrder).toBeGreaterThan(focusOrder);
    expect(minimizedWindow.webContents.focus).not.toHaveBeenCalled();
  });

  it("window blur tolerates a destroyed window", async () => {
    const destroyedWindow = {
      getNativeWindowHandle: () => {
        throw new Error("window destroyed");
      },
      id: 99,
      isDestroyed: () => true,
      isFocused: () => false,
      webContents: {
        focus: vi.fn(),
        isDestroyed: () => true,
      },
    };
    const { terminalFocusCoordinator } = await setupTerminalFocusHarness();

    expect(() =>
      terminalFocusCoordinator.setWindowFocused(
        destroyedWindow as never,
        false,
        "window-blur"
      )
    ).not.toThrow();
  });
});
