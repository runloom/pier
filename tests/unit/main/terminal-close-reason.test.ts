import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("terminal close IPC reason semantics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    const { setTerminalPanelClosedHandler } = await import(
      "@main/ipc/terminal-panel-closed.ts"
    );
    setTerminalPanelClosedHandler(null);
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
      closeTerminal: vi.fn(),
      createTerminal: vi.fn(() => true),
      debugSnapshot: vi.fn(() => "{}"),
      detachWindow: vi.fn(),
      hideTerminal: vi.fn(),
      performTerminalBindingAction: vi.fn(() => true),
      reconcileTerminals: vi.fn(),
      setAppShortcutKeys: vi.fn(),
      setCommandFinishedForwardCallback: vi.fn(),
      setFrame: vi.fn(),
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
      setupWindow: vi.fn(),
      showTerminal: vi.fn(),
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
    vi.doMock("@main/state/terminal-session-state.ts", () => ({
      patchTerminalPanelTab: vi.fn(async () => true),
      patchTerminalPanelTaskStatus: vi.fn(async () => true),
      readTerminalPanelSession: vi.fn(async () => null),
      removeTerminalPanelSession: vi.fn(async () => undefined),
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
    registerTerminalIpc(fakeIpcMain as never);

    return {
      fakeAddon,
      invokeHandlers,
      processClosedForwardCallback: () => processClosedForwardCallback,
      win,
    };
  }

  it("keeps task panel mapping alive when relaunch close only stops the native session", async () => {
    const { fakeAddon, invokeHandlers, win } = await setupHarness();
    const sessionState = await import("@main/state/terminal-session-state.ts");
    const { setTerminalPanelClosedHandler } = await import(
      "@main/ipc/terminal-panel-closed.ts"
    );
    const taskPanelClosed = vi.fn();
    setTerminalPanelClosedHandler(taskPanelClosed);
    const close = invokeHandlers.get("pier:terminal:close");

    await close?.({ sender: win.webContents }, "terminal-1");

    expect(taskPanelClosed).toHaveBeenCalledWith(
      "terminal-1",
      undefined,
      "window-main"
    );
    taskPanelClosed.mockClear();

    await close?.({ sender: win.webContents }, "terminal-1", {
      reason: "relaunch",
    });

    expect(fakeAddon.closeTerminal).toHaveBeenLastCalledWith("7::terminal-1");
    expect(sessionState.removeTerminalPanelSession).toHaveBeenLastCalledWith(
      "window-main",
      "terminal-1"
    );
    expect(taskPanelClosed).not.toHaveBeenCalled();
  });

  it("ignores the native process-close callback caused by a relaunch close", async () => {
    const { fakeAddon, invokeHandlers, processClosedForwardCallback, win } =
      await setupHarness();
    const sessionState = await import("@main/state/terminal-session-state.ts");
    const { setTerminalPanelClosedHandler } = await import(
      "@main/ipc/terminal-panel-closed.ts"
    );
    const taskPanelClosed = vi.fn();
    setTerminalPanelClosedHandler(taskPanelClosed);
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
    expect(taskPanelClosed).not.toHaveBeenCalled();

    processClosed?.(win.id, "7::terminal-1", true);
    await Promise.resolve();
    await Promise.resolve();

    expect(taskPanelClosed).not.toHaveBeenCalled();
  });

  it("preserves the running task activity across a relaunch close so the exit lands", async () => {
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
        status: "running",
        taskId: "task-dev",
      }),
    ]);

    // 生产时序里旧 pty 死亡会在 close 与 finish 之间送达 process-closed →
    // ptyExited；task 层必须挺过这一拍（aggregator 按层语义保留 task 层）。
    foregroundActivityService.ptyExited("terminal-1");
    expect(foregroundActivityService.snapshot().activities).toEqual([
      expect.objectContaining({
        kind: "task",
        panelId: "terminal-1",
        status: "running",
      }),
    ]);

    foregroundActivityService.taskFinished("terminal-1", {
      exitCode: 0,
      status: "success",
    });

    const after = foregroundActivityService.snapshot().activities;
    expect(after).toEqual([
      expect.objectContaining({
        exitCode: 0,
        kind: "task",
        panelId: "terminal-1",
        status: "success",
      }),
    ]);
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
