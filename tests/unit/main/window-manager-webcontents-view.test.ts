import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const hostListeners = new Map<string, (...args: never[]) => void>();
  const webListeners = new Map<string, (...args: never[]) => void>();
  const webOnceListeners = new Map<string, (...args: never[]) => void>();
  const state = {
    throwWhenReadingWindowId: false,
  };

  const webContents = {
    close: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    loadFile: vi.fn(async () => undefined),
    loadURL: vi.fn(async () => undefined),
    on: vi.fn((event: string, listener: (...args: never[]) => void) => {
      webListeners.set(event, listener);
      return webContents;
    }),
    once: vi.fn((event: string, listener: (...args: never[]) => void) => {
      webOnceListeners.set(event, listener);
      return webContents;
    }),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  };

  const appView = {
    setBackgroundColor: vi.fn(),
    setBounds: vi.fn(),
    webContents,
  };

  const baseWindow = {
    close: vi.fn(),
    contentView: {
      addChildView: vi.fn(),
    },
    focus: vi.fn(),
    getContentSize: vi.fn(() => [1280, 800]),
    getNativeWindowHandle: vi.fn(() => Buffer.from("window")),
    get id() {
      if (state.throwWhenReadingWindowId) {
        throw new TypeError("Object has been destroyed");
      }
      return 42;
    },
    isDestroyed: vi.fn(() => false),
    isFocused: vi.fn(() => true),
    isMinimized: vi.fn(() => false),
    moveTop: vi.fn(),
    on: vi.fn((event: string, listener: (...args: never[]) => void) => {
      hostListeners.set(event, listener);
      return baseWindow;
    }),
    restore: vi.fn(),
    setBackgroundColor: vi.fn(),
    show: vi.fn(),
  };

  const browserWindowCtor = vi.fn(function BrowserWindow() {
    throw new Error("BrowserWindow should not be used on macOS");
  });

  return {
    appView,
    baseWindow,
    browserWindowCtor,
    hostListeners,
    state,
    webContents,
    webListeners,
    webOnceListeners,
  };
});

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
  },
  BaseWindow: vi.fn(function BaseWindow() {
    return electronMock.baseWindow;
  }),
  BrowserWindow: Object.assign(electronMock.browserWindowCtor, {
    fromId: vi.fn(),
    getAllWindows: vi.fn(() => []),
    getFocusedWindow: vi.fn(() => null),
  }),
  nativeTheme: {
    shouldUseDarkColors: true,
  },
  shell: {
    openExternal: vi.fn(async () => undefined),
  },
  WebContentsView: vi.fn(function WebContentsView() {
    return electronMock.appView;
  }),
}));

describe.runIf(process.platform === "darwin")(
  "macOS window manager WebContentsView hosting",
  () => {
    beforeEach(() => {
      vi.resetModules();
      vi.clearAllMocks();
      electronMock.hostListeners.clear();
      electronMock.state.throwWhenReadingWindowId = false;
      electronMock.webListeners.clear();
      electronMock.webOnceListeners.clear();
      vi.stubEnv("ELECTRON_RENDERER_URL", "http://127.0.0.1:5173");
    });

    it("creates an opaque BaseWindow with a transparent full-window WebContentsView", async () => {
      const electron = await import("electron");
      const { windowManager } = await import("@main/windows/window-manager.ts");
      const { findWindowContext } = await import(
        "@main/windows/window-identity.ts"
      );

      windowManager.create({ id: "main" });
      const win = windowManager.get("main");

      expect(electron.BaseWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          backgroundColor: "#1e1e1e",
          show: false,
          titleBarStyle: "hiddenInset",
        })
      );
      expect(electron.BrowserWindow).not.toHaveBeenCalled();
      expect(electron.WebContentsView).toHaveBeenCalledWith(
        expect.objectContaining({
          webPreferences: expect.objectContaining({
            additionalArguments: ["--window-id=main"],
            contextIsolation: true,
            nodeIntegration: false,
            preload: expect.stringContaining("preload/index.cjs"),
            sandbox: true,
          }),
        })
      );
      expect(
        electronMock.baseWindow.contentView.addChildView
      ).toHaveBeenCalledWith(electronMock.appView);
      expect(electronMock.appView.setBackgroundColor).toHaveBeenCalledWith(
        "#00000000"
      );
      expect(electronMock.appView.setBounds).toHaveBeenCalledWith({
        height: 800,
        width: 1280,
        x: 0,
        y: 0,
      });
      expect(win ? findWindowContext(win) : null).toMatchObject({
        mode: "restore",
        recordId: "main",
        sessionId: "main",
        windowId: "main",
      });
    });

    it("scopes terminal sessions by durable window record, not reusable runtime id", async () => {
      const { windowManager } = await import("@main/windows/window-manager.ts");
      const { findWindowContext } = await import(
        "@main/windows/window-identity.ts"
      );

      windowManager.create({
        id: "w-1",
        mode: "fresh",
        recordId: "record-a",
      });
      const firstWin = windowManager.get("w-1");
      const firstContext = firstWin ? findWindowContext(firstWin) : null;

      electronMock.hostListeners.get("closed")?.();

      windowManager.create({
        id: "w-1",
        mode: "fresh",
        recordId: "record-b",
      });
      const secondWin = windowManager.get("w-1");
      const secondContext = secondWin ? findWindowContext(secondWin) : null;

      expect(firstContext).toMatchObject({
        mode: "fresh",
        recordId: "record-a",
        sessionId: "record-a",
        windowId: "w-1",
      });
      expect(secondContext).toMatchObject({
        mode: "fresh",
        recordId: "record-b",
        sessionId: "record-b",
        windowId: "w-1",
      });
      expect(secondContext?.sessionId).not.toBe(firstContext?.sessionId);
    });

    it("maps renderer webContents back to the owning app window", async () => {
      const { windowManager } = await import("@main/windows/window-manager.ts");

      windowManager.create({ id: "main" });
      const win = windowManager.get("main");

      expect(
        windowManager.fromWebContents(electronMock.webContents as never)
      ).toBe(win);
    });

    it("closes the hosted webContents when the BaseWindow closes", async () => {
      const { windowManager } = await import("@main/windows/window-manager.ts");

      windowManager.create({ id: "main" });
      electronMock.hostListeners.get("closed")?.();

      expect(electronMock.webContents.close).toHaveBeenCalledOnce();
    });

    it("does not read the Electron id after a destroyed BaseWindow emits closed", async () => {
      const { windowManager } = await import("@main/windows/window-manager.ts");
      const { findAppWindowByElectronId } = await import(
        "@main/windows/window-identity.ts"
      );

      windowManager.create({ id: "main" });
      electronMock.state.throwWhenReadingWindowId = true;

      expect(() => {
        electronMock.hostListeners.get("closed")?.();
      }).not.toThrow();
      expect(findAppWindowByElectronId(42)).toBeNull();
    });

    it("notifies the renderer after native window geometry changes", async () => {
      const { windowManager } = await import("@main/windows/window-manager.ts");

      windowManager.create({ id: "main" });
      electronMock.webContents.send.mockClear();

      electronMock.hostListeners.get("resize")?.();
      electronMock.hostListeners.get("maximize")?.();
      electronMock.hostListeners.get("unmaximize")?.();

      expect(electronMock.webContents.send).toHaveBeenCalledWith(
        "pier:window:layout-pulse",
        { reason: "resize" }
      );
      expect(electronMock.webContents.send).toHaveBeenCalledWith(
        "pier:window:layout-pulse",
        { reason: "zoom" }
      );
      expect(electronMock.webContents.send).toHaveBeenCalledTimes(3);
    });
  }
);
