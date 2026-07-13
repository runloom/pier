import { beforeEach, describe, expect, it, vi } from "vitest";

describe("terminal selection text IPC", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function setupHarness() {
    const invokeHandlers = new Map<string, (...args: unknown[]) => unknown>();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const fakeAddon = {
      applyTerminalInputRouting: vi.fn(),
      applyTerminalPresentation: vi.fn(),
      applyTerminalTheme: vi.fn(),
      closeAllTerminals: vi.fn(),
      closeTerminal: vi.fn(),
      createTerminal: vi.fn(() => true),
      debugSnapshot: vi.fn(() => "{}"),
      detachWindow: vi.fn(),
      performTerminalBindingAction: vi.fn(() => true),
      readSelectionText: vi.fn<(panelId: string) => string | null>((panelId) =>
        panelId === "7::terminal-1" ? "selected markdown" : null
      ),
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
      setupWindow: vi.fn(),
    };
    const winA = {
      focus: vi.fn(),
      getNativeWindowHandle: () => Buffer.from("window-a"),
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
    const winB = {
      focus: vi.fn(),
      getNativeWindowHandle: () => Buffer.from("window-b"),
      id: 8,
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
      patchTerminalPanelAgentStatus: vi.fn(async () => false),
      patchTerminalPanelTab: vi.fn(async () => undefined),
      patchTerminalPanelTaskStatus: vi.fn(async () => true),
      readTerminalPanelSession: vi.fn(async () => null),
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
      findAppWindowByElectronId: vi.fn((id: number) => {
        if (id === winA.id) {
          return winA;
        }
        if (id === winB.id) {
          return winB;
        }
        return null;
      }),
      findAppWindowByWebContents: vi.fn((webContents: unknown) => {
        if (webContents === winA.webContents) {
          return winA;
        }
        if (webContents === winB.webContents) {
          return winB;
        }
        return null;
      }),
      findInternalWindowId: vi.fn((win: { id: number }) => `main-${win.id}`),
    }));

    const { registerTerminalIpc } = await import("@main/ipc/terminal.ts");
    registerTerminalIpc(fakeIpcMain as never, {
      loadNativeAddon: () => ({ addon: fakeAddon as never, error: null }),
    });

    const readSelection = invokeHandlers.get(
      "pier:terminal:read-selection-text"
    );
    if (!readSelection) {
      throw new Error("missing read-selection-text IPC handler");
    }

    return { fakeAddon, handlers, invokeHandlers, readSelection, winA, winB };
  }

  it("returns empty for invalid panel ids without constructing native keys", async () => {
    const { fakeAddon, readSelection, winA } = await setupHarness();

    await expect(readSelection({ sender: winA.webContents })).resolves.toEqual({
      kind: "empty",
    });
    await expect(
      readSelection({ sender: winA.webContents }, 42)
    ).resolves.toEqual({ kind: "empty" });
    await expect(
      readSelection({ sender: winA.webContents }, "")
    ).resolves.toEqual({ kind: "empty" });
    await expect(
      readSelection({ sender: winA.webContents }, "   ")
    ).resolves.toEqual({ kind: "empty" });

    expect(fakeAddon.readSelectionText).not.toHaveBeenCalled();
  });

  it("returns empty when the native panel has no selection or does not exist", async () => {
    const { fakeAddon, readSelection, winA } = await setupHarness();

    await expect(
      readSelection({ sender: winA.webContents }, "missing-panel")
    ).resolves.toEqual({ kind: "empty" });

    expect(fakeAddon.readSelectionText).toHaveBeenCalledWith(
      "7::missing-panel"
    );
  });

  it("returns selected text from the native addon", async () => {
    const { fakeAddon, readSelection, winA } = await setupHarness();

    await expect(
      readSelection({ sender: winA.webContents }, "terminal-1")
    ).resolves.toEqual({ kind: "ok", text: "selected markdown" });

    expect(fakeAddon.readSelectionText).toHaveBeenCalledWith("7::terminal-1");
  });

  it("scopes same renderer panel ids by sender window", async () => {
    const { fakeAddon, readSelection, winA, winB } = await setupHarness();
    fakeAddon.readSelectionText.mockImplementation((panelId: string) => {
      if (panelId === "7::terminal-1") {
        return "window A selection";
      }
      if (panelId === "8::terminal-1") {
        return "window B selection";
      }
      return null;
    });

    await expect(
      readSelection({ sender: winA.webContents }, "terminal-1")
    ).resolves.toEqual({ kind: "ok", text: "window A selection" });
    await expect(
      readSelection({ sender: winB.webContents }, "terminal-1")
    ).resolves.toEqual({ kind: "ok", text: "window B selection" });

    expect(fakeAddon.readSelectionText).toHaveBeenCalledWith("7::terminal-1");
    expect(fakeAddon.readSelectionText).toHaveBeenCalledWith("8::terminal-1");
  });

  it("converts native read failures into error results", async () => {
    const { fakeAddon, readSelection, winA } = await setupHarness();
    fakeAddon.readSelectionText.mockImplementation(() => {
      throw new Error("native read failed");
    });

    await expect(
      readSelection({ sender: winA.webContents }, "terminal-1")
    ).resolves.toEqual({ kind: "error", message: "native read failed" });
  });
});
