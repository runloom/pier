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
});
