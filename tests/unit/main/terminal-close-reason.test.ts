import { beforeEach, describe, expect, it, vi } from "vitest";

describe("terminal close IPC reason semantics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function setupHarness() {
    const invokeHandlers = new Map<
      string,
      (...args: unknown[]) => unknown | Promise<unknown>
    >();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    type ProcessClosedForwardCallback = (
      browserWindowId: number,
      panelId: string,
      processAlive: boolean
    ) => void;
    let processClosedForwardCallback: ProcessClosedForwardCallback | undefined;
    const fakeAddon = {
      applyTerminalInputRouting: vi.fn(),
      applyTerminalPresentation: vi.fn(),
      applyTerminalTheme: vi.fn(),
      closeAllTerminals: vi.fn(),
      closeTerminal: vi.fn(() => true),
      createTerminal: vi.fn(() => true),
      debugSnapshot: vi.fn(() => "{}"),
      detachWindow: vi.fn(),
      performTerminalBindingAction: vi.fn(() => true),
      reconcileTerminals: vi.fn(),
      setAppShortcutKeys: vi.fn(),
      setCommandFinishedForwardCallback: vi.fn(),
      setKeyboardForwardCallback: vi.fn(),
      setModifierForwardCallback: vi.fn(),
      setMouseForwardCallback: vi.fn(),
      setProcessClosedForwardCallback: vi.fn(
        (cb: ProcessClosedForwardCallback) => {
          processClosedForwardCallback = cb;
        }
      ),
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
    const taskService = {
      bindTerminalProcessController: vi.fn(),
      completePanel: vi.fn(async () => null),
      isStopRequested: vi.fn(() => false),
      markPanelClosed: vi.fn(),
      output: vi.fn(() => null),
      runsSnapshot: vi.fn(() => ({ runs: {}, version: 0 })),
      subscribeOutput: vi.fn(() => vi.fn()),
      subscribeRuns: vi.fn(() => vi.fn()),
    };

    vi.doMock("electron", () => ({
      app: { getPath: vi.fn((k: string) => `/tmp/pier-test-${k}`) },
    }));
    vi.doMock("@main/state/terminal-session-state.ts", () => ({
      clearTerminalPanelAgent: vi.fn(async () => undefined),
      patchTerminalPanelAgentStatus: vi.fn(async () => false),
      patchTerminalPanelTab: vi.fn(async () => true),
      patchTerminalPanelTaskStatus: vi.fn(async () => true),
      readTerminalPanelSession: vi.fn(async () => null),
      removeTerminalPanelSession: vi.fn(async () => undefined),
      retainTerminalPanelSessions: vi.fn(async () => undefined),
      updateTerminalPanelAgent: vi.fn(async () => undefined),
      updateTerminalPanelAgentResume: vi.fn(async () => true),
      updateTerminalPanelContext: vi.fn(async () => undefined),
      updateTerminalPanelTab: vi.fn(async () => undefined),
      updateTerminalPanelTask: vi.fn(async () => undefined),
      updateTerminalPanelTitle: vi.fn(async () => undefined),
    }));
    vi.doMock("@main/state/panel-context-state.ts", () => ({
      recordRecentPanelContext: vi.fn(async () => undefined),
    }));
    vi.doMock("@main/state/terminal-launch-state.ts", () => ({
      terminalLaunchRegistry: {
        consume: vi.fn(),
        read: vi.fn(() => null),
        register: vi.fn(),
      },
    }));
    vi.doMock("@main/services/panel-context-resolver.ts", () => ({
      resolvePanelContextForPath: vi.fn(async (path: string) => ({
        contextId: `ctx:${path}`,
        cwd: path,
        openedPath: path,
        projectRootPath: path,
        source: "panel",
        updatedAt: 1,
        worktreeKey: path,
      })),
    }));
    vi.doMock("@main/windows/window-identity.ts", () => ({
      findAppWindowByElectronId: vi.fn((id: number) =>
        id === win.id ? win : null
      ),
      findAppWindowByInternalId: vi.fn((id: string) =>
        id === "window-main" ? win : null
      ),
      findAppWindowByWebContents: vi.fn(() => win),
      findInternalWindowId: vi.fn(() => "window-main"),
    }));

    const { registerTerminalIpc } = await import("@main/ipc/terminal.ts");
    registerTerminalIpc(fakeIpcMain as never, {
      loadNativeAddon: () => ({ addon: fakeAddon as never, error: null }),
      taskService: taskService as never,
    });

    return {
      fakeAddon,
      invokeHandlers,
      processClosedForwardCallback: () => processClosedForwardCallback,
      taskService,
      win,
    };
  }

  it("keeps task panel mapping alive when relaunch close only stops the native session", async () => {
    const { fakeAddon, invokeHandlers, taskService, win } =
      await setupHarness();
    const sessionState = await import("@main/state/terminal-session-state.ts");
    const close = invokeHandlers.get("pier:terminal:close");

    await close?.({ sender: win.webContents }, "terminal-1");

    expect(taskService.markPanelClosed).toHaveBeenCalledWith(
      "terminal-1",
      "window-main"
    );
    taskService.markPanelClosed.mockClear();

    await close?.({ sender: win.webContents }, "terminal-1", {
      reason: "relaunch",
    });

    expect(fakeAddon.closeTerminal).toHaveBeenLastCalledWith("7::terminal-1");
    expect(sessionState.removeTerminalPanelSession).toHaveBeenLastCalledWith(
      "window-main",
      "terminal-1"
    );
    expect(taskService.markPanelClosed).not.toHaveBeenCalled();
  });

  it("reports force stop failure when the native terminal does not exist", async () => {
    const { fakeAddon, taskService } = await setupHarness();
    fakeAddon.closeTerminal.mockReturnValue(false);
    const controller = taskService.bindTerminalProcessController.mock
      .calls[0]?.[0] as
      | {
          forceStop(
            panelId: string,
            windowId?: string
          ): {
            message?: string;
            ok: boolean;
          };
        }
      | undefined;

    expect(controller?.forceStop("terminal-1", "window-main")).toEqual({
      message: "terminal process was not found",
      ok: false,
    });
    expect(fakeAddon.closeTerminal).toHaveBeenCalledWith("7::terminal-1");
  });

  it("ignores the native process-close callback caused by a relaunch close", async () => {
    const {
      fakeAddon,
      invokeHandlers,
      processClosedForwardCallback,
      taskService,
      win,
    } = await setupHarness();
    const sessionState = await import("@main/state/terminal-session-state.ts");
    const close = invokeHandlers.get("pier:terminal:close");
    const processClosed = processClosedForwardCallback();

    expect(processClosed).toBeTypeOf("function");

    await close?.({ sender: win.webContents }, "terminal-1", {
      reason: "relaunch",
    });

    expect(fakeAddon.closeTerminal).toHaveBeenLastCalledWith("7::terminal-1");
    expect(sessionState.removeTerminalPanelSession).toHaveBeenLastCalledWith(
      "window-main",
      "terminal-1"
    );
    expect(taskService.markPanelClosed).not.toHaveBeenCalled();

    processClosed?.(win.id, "7::terminal-1", true);
    await Promise.resolve();
    await Promise.resolve();

    expect(taskService.markPanelClosed).not.toHaveBeenCalled();
  });

  it("preserves the task occupation across a relaunch close until cleared", async () => {
    const { invokeHandlers, win } = await setupHarness();
    // 动态 import 必须晚于 setupHarness 的 vi.doMock（resetModules 后按测试
    // 注册 mock）——静态 import 会绑定未 mock 的模块实例。
    const { foregroundActivityService } = await import(
      "@main/ipc/foreground-activity.ts"
    );
    const close = invokeHandlers.get("pier:terminal:close");

    // rerun 时序：run.spawn 先登记新 running task 层，renderer 随后才发
    // relaunch close。
    foregroundActivityService.taskLaunched("terminal-1", "window-main", {
      label: "dev",
      runId: "run-1",
      taskId: "task-dev",
    });
    await close?.({ sender: win.webContents }, "terminal-1", {
      reason: "relaunch",
    });

    const during = foregroundActivityService.snapshot().activities;
    expect(during).toEqual([
      expect.objectContaining({
        kind: "task",
        panelId: "terminal-1",
        taskId: "task-dev",
      }),
    ]);

    foregroundActivityService.ptyExited("terminal-1");
    expect(foregroundActivityService.snapshot().activities).toEqual([
      expect.objectContaining({
        kind: "task",
        panelId: "terminal-1",
      }),
    ]);

    foregroundActivityService.taskFinished("terminal-1", "window-main", {
      runId: "run-1",
    });

    expect(foregroundActivityService.snapshot().activities).toEqual([]);
  });

  // 非回归守卫：真实关闭（无 reason）仍走 panelClosed 清理——锚住 else 分支，
  // 防未来把 relaunch 豁免扩大到所有 close。
  it("clears the task activity when the panel closes for real", async () => {
    const { invokeHandlers, win } = await setupHarness();
    // 同上：mock 注册后才能拿到被 mock 的模块实例。
    const { foregroundActivityService } = await import(
      "@main/ipc/foreground-activity.ts"
    );
    const close = invokeHandlers.get("pier:terminal:close");

    foregroundActivityService.taskLaunched("terminal-1", "window-main", {
      label: "dev",
      runId: "run-1",
      taskId: "task-dev",
    });
    await close?.({ sender: win.webContents }, "terminal-1");

    expect(foregroundActivityService.snapshot().activities).toEqual([]);
  });

  it("clears pre-registered task activity when native terminal create fails", async () => {
    const { fakeAddon, invokeHandlers, win } = await setupHarness();
    // 同上：mock 注册后才能拿到被 mock 的模块实例。
    const { foregroundActivityService } = await import(
      "@main/ipc/foreground-activity.ts"
    );
    const create = invokeHandlers.get("pier:terminal:create");

    // fresh spawn 与 rerun relaunch 共通时序：taskLaunched 先验登记 running
    // 层, renderer 随后才 create。create 失败 = pty 从未活过, 层必须撤。
    foregroundActivityService.taskLaunched("terminal-1", "window-main", {
      label: "dev",
      runId: "run-1",
      taskId: "task-dev",
    });
    fakeAddon.createTerminal.mockReturnValueOnce(false);

    const result = await create?.(
      { sender: win.webContents },
      {
        font: { family: "Menlo", size: 12 },
        frame: { height: 100, width: 100, x: 0, y: 0 },
        panelId: "terminal-1",
      }
    );

    expect(result).toEqual({
      ok: false,
      error: "createTerminal returned false",
    });
    expect(foregroundActivityService.snapshot().activities).toEqual([]);
  });
});
