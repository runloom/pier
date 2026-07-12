import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const ipcListeners = new Map<string, (...args: unknown[]) => void>();
  const instances: ReturnType<typeof createWindow>[] = [];
  const mainFrame = {};
  const state = { isQuitting: false };
  const showMessageBox = vi.fn(async () => ({ response: 1 }));
  const targetWindow = {
    getNativeWindowHandle: vi.fn(() => Buffer.from("window")),
    id: 17,
  };

  function createWindow() {
    const webListeners = new Map<string, (...args: unknown[]) => void>();
    const webOnceListeners = new Map<string, (...args: unknown[]) => void>();
    const webContents = {
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      mainFrame,
      off: vi.fn((event: string) => {
        webListeners.delete(event);
        webOnceListeners.delete(event);
        return webContents;
      }),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        webListeners.set(event, listener);
        return webContents;
      }),
      once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        webOnceListeners.set(event, listener);
        return webContents;
      }),
      reload: vi.fn(),
      send: vi.fn(),
      setBackgroundThrottling: vi.fn(),
    };
    const instance = {
      close: vi.fn(),
      destroy: vi.fn(),
      focus: vi.fn(),
      getNativeWindowHandle: vi.fn(() => Buffer.from("debug-window")),
      id: 23,
      isDestroyed: vi.fn(() => false),
      isFocused: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      loadFile: vi.fn(async () => undefined),
      loadURL: vi.fn(async () => undefined),
      moveTop: vi.fn(),
      on: vi.fn(() => instance),
      restore: vi.fn(),
      setBackgroundColor: vi.fn(),
      setOpacity: vi.fn(),
      show: vi.fn(),
      showInactive: vi.fn(),
      webContents,
      webListeners,
      webOnceListeners,
    };
    return instance;
  }

  return {
    BrowserWindow: vi.fn(function BrowserWindow() {
      const instance = createWindow();
      instances.push(instance);
      return instance;
    }),
    instances,
    ipcListeners,
    mainFrame,
    showMessageBox,
    state,
    targetWindow,
  };
});

vi.mock("electron", () => ({
  app: {
    focus: vi.fn(),
    getLocale: vi.fn(() => "en"),
    isPackaged: false,
  },
  BrowserWindow: electronMock.BrowserWindow,
  dialog: { showMessageBox: electronMock.showMessageBox },
  ipcMain: {
    off: vi.fn((event: string) => electronMock.ipcListeners.delete(event)),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      electronMock.ipcListeners.set(event, listener);
    }),
  },
}));

vi.mock("@main/ipc/terminal.ts", () => ({
  windowFromWebContents: vi.fn(() => electronMock.targetWindow),
}));

describe("terminal debug window IPC", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    electronMock.instances.length = 0;
    electronMock.ipcListeners.clear();
    electronMock.showMessageBox.mockResolvedValue({ response: 1 });
    electronMock.state.isQuitting = false;
    vi.stubEnv("ELECTRON_RENDERER_URL", "http://127.0.0.1:5173");
  });

  async function openDebugWindow() {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, handler);
        }
      ),
    };
    const { registerTerminalDebugWindowIpc } = await import(
      "@main/ipc/terminal-debug-window.ts"
    );
    registerTerminalDebugWindowIpc(ipcMain as never, {
      isQuitting: () => electronMock.state.isQuitting,
    });
    const result = handlers.get("pier:terminal-debug:open-window")?.({
      sender: {},
    });
    return { result, window: electronMock.instances[0] };
  }

  it("retains the window and shows it only after its renderer boot signal", async () => {
    const { result, window } = await openDebugWindow();

    expect(result).toEqual({ ok: true, targetBrowserWindowId: 17 });
    expect(window?.on).toHaveBeenCalledWith("closed", expect.any(Function));
    expect(window?.showInactive).not.toHaveBeenCalled();

    electronMock.ipcListeners.get("pier://window:renderer-boot-request")?.({
      sender: window?.webContents,
    });
    const challenge = window?.webContents.send.mock.calls.find(
      ([channel]) => channel === "pier://window:renderer-boot-challenge"
    )?.[1];
    electronMock.ipcListeners.get("pier://window:renderer-ready")?.(
      { sender: window?.webContents },
      challenge
    );

    expect(window?.showInactive).toHaveBeenCalledOnce();
  });

  it("reports debug renderer load failures instead of swallowing them", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { window } = await openDebugWindow();

    window?.webListeners.get("preload-error")?.(
      {},
      "/missing/preload.cjs",
      new Error("preload failed")
    );

    await vi.waitFor(() =>
      expect(electronMock.showMessageBox).toHaveBeenCalledOnce()
    );
    expect(error).toHaveBeenCalledWith(
      "[pier-preload-error]",
      "/missing/preload.cjs",
      "preload failed"
    );
  });

  it("does not recover the debug renderer while the application is quitting", async () => {
    const { window } = await openDebugWindow();
    electronMock.state.isQuitting = true;

    window?.webListeners.get("render-process-gone")?.(
      {},
      {
        exitCode: 9,
        reason: "crashed",
      }
    );
    window?.webListeners.get("did-fail-load")?.(
      {},
      -6,
      "ERR_FILE_NOT_FOUND",
      "file:///missing/index.html",
      true
    );
    await Promise.resolve();

    expect(electronMock.showMessageBox).not.toHaveBeenCalled();
    expect(window?.webContents.reload).not.toHaveBeenCalled();
  });
});
