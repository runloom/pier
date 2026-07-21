import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const hostListeners = new Map<string, (...args: unknown[]) => void>();
  const ipcMainListeners = new Map<string, (...args: unknown[]) => void>();
  const webListeners = new Map<string, (...args: unknown[]) => void>();
  const webOnceListeners = new Map<string, (...args: unknown[]) => void>();
  const state = {
    throwWhenReadingWindowId: false,
  };
  const mainFrame = {};
  const showMessageBox = vi.fn(async () => ({ response: 0 }));

  const webContents = {
    close: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    loadFile: vi.fn(async () => undefined),
    loadURL: vi.fn(async () => undefined),
    mainFrame,
    reload: vi.fn(),
    setBackgroundThrottling: vi.fn(),
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
    destroy: vi.fn(),
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
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      hostListeners.set(event, listener);
      return baseWindow;
    }),
    restore: vi.fn(),
    setBackgroundColor: vi.fn(),
    setOpacity: vi.fn(),
    show: vi.fn(),
    showInactive: vi.fn(),
  };

  const browserWindowCtor = vi.fn(function BrowserWindow() {
    throw new Error("BrowserWindow should not be used on macOS");
  });

  return {
    appView,
    baseWindow,
    browserWindowCtor,
    hostListeners,
    ipcMainListeners,
    mainFrame,
    showMessageBox,
    state,
    webContents,
    webListeners,
    webOnceListeners,
  };
});

vi.mock("electron", () => ({
  app: {
    getLocale: vi.fn(() => "en"),
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
  dialog: {
    showMessageBox: electronMock.showMessageBox,
  },
  ipcMain: {
    off: vi.fn((event: string) => {
      electronMock.ipcMainListeners.delete(event);
    }),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      electronMock.ipcMainListeners.set(event, listener);
    }),
  },
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

const describeMockedMacOSWindowManager = describe.each(["darwin"] as const);

describeMockedMacOSWindowManager(
  "macOS window manager WebContentsView hosting",
  (platform) => {
    const bootChallenge = (): unknown => {
      electronMock.ipcMainListeners.get(
        "pier://window:renderer-boot-request"
      )?.({ sender: electronMock.webContents });
      return [...electronMock.webContents.send.mock.calls]
        .reverse()
        .find(
          ([channel]) => channel === "pier://window:renderer-boot-challenge"
        )?.[1];
    };
    const signalRendererBoot = (): void => {
      electronMock.ipcMainListeners.get("pier://window:renderer-ready")?.(
        { sender: electronMock.webContents },
        bootChallenge()
      );
    };

    beforeEach(() => {
      vi.resetModules();
      vi.clearAllMocks();
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      electronMock.hostListeners.clear();
      electronMock.ipcMainListeners.clear();
      electronMock.state.throwWhenReadingWindowId = false;
      electronMock.showMessageBox.mockResolvedValue({ response: 0 });
      Reflect.set(
        electronMock.webContents,
        "mainFrame",
        electronMock.mainFrame
      );
      electronMock.webListeners.clear();
      electronMock.webOnceListeners.clear();
      vi.stubEnv("ELECTRON_RENDERER_URL", "http://127.0.0.1:5173");
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
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
          opacity: 0,
          show: false,
          titleBarStyle: "hiddenInset",
        })
      );
      expect(electron.BrowserWindow).not.toHaveBeenCalled();
      expect(electron.WebContentsView).toHaveBeenCalledWith(
        expect.objectContaining({
          webPreferences: expect.objectContaining({
            additionalArguments: ["--window-id=main"],
            autoplayPolicy: "no-user-gesture-required",
            backgroundThrottling: false,
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
        windowId: "main",
      });
    });

    it("denies renderer navigation without opening the system browser", async () => {
      const electron = await import("electron");
      const { windowManager } = await import("@main/windows/window-manager.ts");

      windowManager.create({ id: "main" });
      const openHandler = electronMock.webContents.setWindowOpenHandler.mock
        .calls[0]?.[0] as
        | ((details: { url: string }) => { action: "deny" })
        | undefined;

      expect(openHandler?.({ url: "https://example.com/docs" })).toEqual({
        action: "deny",
      });
      expect(electron.shell.openExternal).not.toHaveBeenCalled();

      const navigationEvent = { preventDefault: vi.fn() };
      electronMock.webListeners.get("will-navigate")?.(navigationEvent);
      expect(navigationEvent.preventDefault).toHaveBeenCalledOnce();
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
        windowId: "w-1",
      });
      expect(secondContext).toMatchObject({
        mode: "fresh",
        recordId: "record-b",
        windowId: "w-1",
      });
      expect(secondContext?.recordId).not.toBe(firstContext?.recordId);
    });

    it("maps renderer webContents back to the owning app window", async () => {
      const { windowManager } = await import("@main/windows/window-manager.ts");

      windowManager.create({ id: "main" });
      const win = windowManager.get("main");

      expect(
        windowManager.fromWebContents(electronMock.webContents as never)
      ).toBe(win);
    });

    it("notifies lifecycle subscribers when a window is created", async () => {
      const { windowManager } = await import("@main/windows/window-manager.ts");
      const onCreate = vi.fn();
      windowManager.onCreate(onCreate);

      windowManager.create({
        id: "main",
        mode: "fresh",
        recordId: "record-main",
      });
      const win = windowManager.get("main");

      expect(onCreate).toHaveBeenCalledWith({
        recordId: "record-main",
        window: win,
        windowId: "main",
      });
    });

    it("closes the hosted webContents when the BaseWindow closes", async () => {
      const { windowManager } = await import("@main/windows/window-manager.ts");

      windowManager.create({ id: "main" });
      electronMock.hostListeners.get("closed")?.();

      expect(electronMock.webContents.close).toHaveBeenCalledOnce();
    });

    it("retries a vetoed close and only closes after every barrier allows it", async () => {
      const { windowManager } = await import("@main/windows/window-manager.ts");
      const decisions: Array<"allow" | "veto"> = ["veto", "allow"];
      const beforeClose = vi.fn(async () => decisions.shift() ?? "veto");
      windowManager.onBeforeClose(beforeClose);
      windowManager.create({ id: "main", recordId: "record-main" });
      const close = electronMock.hostListeners.get("close");
      const firstEvent = { preventDefault: vi.fn() };

      close?.(firstEvent);
      await vi.waitFor(() => expect(beforeClose).toHaveBeenCalledTimes(1));
      await Promise.resolve();
      await Promise.resolve();

      expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
      expect(electronMock.baseWindow.close).not.toHaveBeenCalled();

      const secondEvent = { preventDefault: vi.fn() };
      close?.(secondEvent);
      await vi.waitFor(() =>
        expect(electronMock.baseWindow.close).toHaveBeenCalledOnce()
      );

      expect(secondEvent.preventDefault).toHaveBeenCalledOnce();
      expect(beforeClose).toHaveBeenCalledTimes(2);
    });

    it("keeps the window open when a before-close barrier throws", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { windowManager } = await import("@main/windows/window-manager.ts");
      windowManager.onBeforeClose(async () => {
        throw new Error("draft flush failed");
      });
      windowManager.create({ id: "main", recordId: "record-main" });
      const event = { preventDefault: vi.fn() };

      electronMock.hostListeners.get("close")?.(event);
      await vi.waitFor(() => expect(error).toHaveBeenCalled());

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(electronMock.baseWindow.close).not.toHaveBeenCalled();
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
      electronMock.hostListeners.get("resized")?.();
      electronMock.hostListeners.get("maximize")?.();
      electronMock.hostListeners.get("unmaximize")?.();

      expect(electronMock.webContents.send).toHaveBeenNthCalledWith(
        1,
        "pier:window:layout-pulse",
        { phase: "active", reason: "resize" }
      );
      expect(electronMock.webContents.send).toHaveBeenNthCalledWith(
        2,
        "pier:window:layout-pulse",
        { phase: "end", reason: "resize" }
      );
      expect(electronMock.webContents.send).toHaveBeenNthCalledWith(
        3,
        "pier:window:layout-pulse",
        { reason: "zoom" }
      );
      expect(electronMock.webContents.send).toHaveBeenNthCalledWith(
        4,
        "pier:window:layout-pulse",
        { reason: "zoom" }
      );
      expect(electronMock.webContents.send).toHaveBeenCalledTimes(4);
    });

    it("waits for renderer ready before showing the foreground window", async () => {
      const { windowManager } = await import("@main/windows/window-manager.ts");

      windowManager.create({ id: "main" });

      expect(electronMock.baseWindow.show).not.toHaveBeenCalled();
      expect(electronMock.baseWindow.showInactive).toHaveBeenCalledOnce();

      signalRendererBoot();

      expect(electronMock.baseWindow.show).toHaveBeenCalledOnce();
      expect(electronMock.baseWindow.showInactive).toHaveBeenCalledOnce();
      expect(electronMock.baseWindow.setOpacity).toHaveBeenCalledWith(1);
      expect(
        electronMock.webContents.setBackgroundThrottling
      ).toHaveBeenCalledWith(true);
    });

    it("issues the boot challenge only to the requesting renderer", async () => {
      const { windowManager } = await import("@main/windows/window-manager.ts");

      windowManager.create({ id: "main" });

      electronMock.ipcMainListeners.get(
        "pier://window:renderer-boot-request"
      )?.({ sender: {} });
      expect(electronMock.webContents.send).not.toHaveBeenCalledWith(
        "pier://window:renderer-boot-challenge",
        expect.anything()
      );

      electronMock.ipcMainListeners.get(
        "pier://window:renderer-boot-request"
      )?.({ sender: electronMock.webContents });
      expect(electronMock.webContents.send).toHaveBeenCalledWith(
        "pier://window:renderer-boot-challenge",
        expect.any(String)
      );
    });

    it("shows restored background windows without stealing focus", async () => {
      const { windowManager } = await import("@main/windows/window-manager.ts");

      windowManager.create({ id: "main", showInactive: true });
      signalRendererBoot();

      expect(electronMock.baseWindow.showInactive).toHaveBeenCalledTimes(2);
      expect(electronMock.baseWindow.show).not.toHaveBeenCalled();
    });

    it("reports a renderer navigation that never reaches the boot signal", async () => {
      vi.useFakeTimers();
      const error = vi.spyOn(console, "error").mockImplementation(() => {
        // test spy
      });
      const { windowManager } = await import("@main/windows/window-manager.ts");

      windowManager.create({ id: "main", recordId: "record-main" });
      vi.advanceTimersByTime(14_999);
      expect(electronMock.baseWindow.show).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      await Promise.resolve();

      expect(electronMock.baseWindow.show).not.toHaveBeenCalled();
      expect(electronMock.showMessageBox).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledWith(
        "[window-startup] renderer boot timed out",
        expect.objectContaining({
          recordId: "record-main",
          showMode: "active",
          windowId: "main",
        })
      );
    });

    it("shows the startup shell without waiting for slow workspace initialization", async () => {
      vi.useFakeTimers();
      const { windowManager } = await import("@main/windows/window-manager.ts");

      windowManager.create({ id: "main" });
      vi.advanceTimersByTime(3001);
      expect(electronMock.showMessageBox).not.toHaveBeenCalled();

      signalRendererBoot();

      expect(electronMock.baseWindow.show).toHaveBeenCalledOnce();
      expect(electronMock.showMessageBox).not.toHaveBeenCalled();
    });

    it("reports a boot challenge delivery failure", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      electronMock.webContents.send.mockImplementationOnce(() => {
        throw new Error("renderer unavailable");
      });
      const { windowManager } = await import("@main/windows/window-manager.ts");
      windowManager.create({ id: "main" });

      electronMock.ipcMainListeners.get(
        "pier://window:renderer-boot-request"
      )?.({ sender: electronMock.webContents });

      await vi.waitFor(() =>
        expect(electronMock.showMessageBox).toHaveBeenCalledOnce()
      );
      expect(error).toHaveBeenCalledWith(
        "[window-startup] boot challenge failed:",
        expect.any(Error)
      );
    });

    it("keeps a failed renderer hidden and offers repeatable native retry", async () => {
      const { windowManager } = await import("@main/windows/window-manager.ts");
      windowManager.create({ id: "main" });

      electronMock.webListeners.get("did-fail-load")?.(
        {},
        -6,
        "ERR_FILE_NOT_FOUND",
        "file:///missing/index.html",
        true
      );

      await vi.waitFor(() =>
        expect(electronMock.showMessageBox).toHaveBeenCalledWith(
          expect.objectContaining({
            buttons: ["Retry", "Close window"],
            type: "error",
          })
        )
      );
      await vi.waitFor(() =>
        expect(electronMock.webContents.reload).toHaveBeenCalledOnce()
      );
      electronMock.webListeners.get("did-fail-load")?.(
        {},
        -6,
        "ERR_FILE_NOT_FOUND",
        "file:///missing/index.html",
        true
      );
      await vi.waitFor(() =>
        expect(electronMock.showMessageBox).toHaveBeenCalledTimes(2)
      );
      await vi.waitFor(() =>
        expect(electronMock.webContents.reload).toHaveBeenCalledTimes(2)
      );
      expect(electronMock.baseWindow.show).not.toHaveBeenCalled();
    });

    it("ignores an aborted navigation instead of reporting renderer failure", async () => {
      const { windowManager } = await import("@main/windows/window-manager.ts");
      windowManager.create({ id: "main" });

      electronMock.webListeners.get("did-fail-load")?.(
        {},
        -3,
        "ERR_ABORTED",
        "http://127.0.0.1:5173",
        true
      );
      await Promise.resolve();

      expect(electronMock.showMessageBox).not.toHaveBeenCalled();
    });

    it("ignores load promise rejection with ERR_ABORTED", async () => {
      electronMock.webContents.loadURL.mockRejectedValueOnce(
        Object.assign(new Error("navigation aborted"), { code: "ERR_ABORTED" })
      );
      const { windowManager } = await import("@main/windows/window-manager.ts");

      windowManager.create({ id: "main" });
      await Promise.resolve();
      await Promise.resolve();

      expect(electronMock.showMessageBox).not.toHaveBeenCalled();
    });

    it("coalesces global renderer resource failures across windows", async () => {
      const { RendererResourceFailureCoordinator } = await import(
        "@main/windows/renderer-failure-recovery.ts"
      );
      const first = {
        destroy: vi.fn(),
        isDestroyed: vi.fn(() => false),
        webContents: { reload: vi.fn() },
      };
      const second = {
        destroy: vi.fn(),
        isDestroyed: vi.fn(() => false),
        webContents: { reload: vi.fn() },
      };
      const coordinator = new RendererResourceFailureCoordinator(async () => ({
        checkboxChecked: false,
        ...(await electronMock.showMessageBox()),
      }));

      coordinator.report(
        {
          isQuitting: () => false,
          retry: () => first.webContents.reload(),
          window: first as never,
        },
        { detail: "missing renderer bundle", kind: "load" }
      );
      coordinator.report(
        {
          isQuitting: () => false,
          retry: () => second.webContents.reload(),
          window: second as never,
        },
        { detail: "missing renderer bundle", kind: "load" }
      );

      expect(electronMock.showMessageBox).toHaveBeenCalledOnce();
      await vi.waitFor(() => {
        expect(first.webContents.reload).toHaveBeenCalledOnce();
        expect(second.webContents.reload).toHaveBeenCalledOnce();
      });
    });

    it("isolates per-window recovery failures in a coalesced decision", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { RendererResourceFailureCoordinator } = await import(
        "@main/windows/renderer-failure-recovery.ts"
      );
      const first = {
        destroy: vi.fn(() => {
          throw new Error("destroy failed");
        }),
        isDestroyed: vi.fn(() => false),
        webContents: { reload: vi.fn() },
      };
      const second = {
        destroy: vi.fn(),
        isDestroyed: vi.fn(() => false),
        webContents: { reload: vi.fn() },
      };
      const coordinator = new RendererResourceFailureCoordinator(async () => ({
        checkboxChecked: false,
        response: 0,
      }));

      coordinator.report(
        {
          isQuitting: () => false,
          retry: () => {
            throw new Error("reload failed");
          },
          window: first as never,
        },
        { detail: "missing renderer bundle", kind: "load" }
      );
      coordinator.report(
        {
          isQuitting: () => false,
          retry: () => second.webContents.reload(),
          window: second as never,
        },
        { detail: "missing renderer bundle", kind: "load" }
      );
      await Promise.resolve();
      await Promise.resolve();

      expect(second.webContents.reload).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledWith(
        "[renderer-failure-target] recovery failed:",
        expect.any(Error)
      );
      expect(error).toHaveBeenCalledWith(
        "[renderer-failure-target] destroy fallback failed:",
        expect.any(Error)
      );
    });

    it("reports preload failures through the same native recovery prompt", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { windowManager } = await import("@main/windows/window-manager.ts");
      windowManager.create({ id: "main" });

      electronMock.webListeners.get("preload-error")?.(
        undefined,
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

    it("keeps a preload-failed window hidden until retry installs a new show gate", async () => {
      vi.useFakeTimers();
      let resolvePrompt: ((value: { response: number }) => void) | undefined;
      electronMock.showMessageBox.mockImplementationOnce(
        async () =>
          await new Promise<{ response: number }>((resolve) => {
            resolvePrompt = resolve;
          })
      );
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { windowManager } = await import("@main/windows/window-manager.ts");
      windowManager.create({ id: "main" });

      electronMock.webListeners.get("preload-error")?.(
        undefined,
        "/missing/preload.cjs",
        new Error("preload failed")
      );
      await vi.advanceTimersByTimeAsync(15_000);
      expect(electronMock.baseWindow.show).not.toHaveBeenCalled();

      resolvePrompt?.({ response: 0 });
      await vi.waitFor(() =>
        expect(electronMock.webContents.reload).toHaveBeenCalledOnce()
      );
      electronMock.ipcMainListeners.get("pier://window:renderer-ready")?.(
        { sender: electronMock.webContents },
        "stale-challenge"
      );
      expect(electronMock.baseWindow.show).not.toHaveBeenCalled();

      electronMock.ipcMainListeners.get(
        "pier://window:renderer-boot-request"
      )?.({ sender: electronMock.webContents });
      electronMock.ipcMainListeners.get("pier://window:renderer-ready")?.(
        { sender: electronMock.webContents },
        "stale-challenge"
      );
      expect(electronMock.baseWindow.show).not.toHaveBeenCalled();
      const challenge = [...electronMock.webContents.send.mock.calls]
        .reverse()
        .find(
          ([channel]) => channel === "pier://window:renderer-boot-challenge"
        )?.[1];
      electronMock.ipcMainListeners.get("pier://window:renderer-ready")?.(
        { sender: electronMock.webContents },
        challenge
      );

      expect(electronMock.baseWindow.show).toHaveBeenCalledOnce();
    });

    it("keeps a pre-show renderer crash hidden until the retry navigation is ready", async () => {
      vi.useFakeTimers();
      let resolvePrompt: ((value: { response: number }) => void) | undefined;
      electronMock.showMessageBox.mockImplementationOnce(
        async () =>
          await new Promise<{ response: number }>((resolve) => {
            resolvePrompt = resolve;
          })
      );
      const { windowManager } = await import("@main/windows/window-manager.ts");
      windowManager.create({ id: "main" });
      electronMock.webListeners.get("render-process-gone")?.(undefined, {
        exitCode: 9,
        reason: "crashed",
      });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(electronMock.baseWindow.show).not.toHaveBeenCalled();

      resolvePrompt?.({ response: 0 });
      await vi.waitFor(() =>
        expect(electronMock.webContents.reload).toHaveBeenCalledOnce()
      );
      electronMock.ipcMainListeners.get("pier://window:renderer-ready")?.(
        { sender: electronMock.webContents },
        "stale-challenge"
      );
      expect(electronMock.baseWindow.show).not.toHaveBeenCalled();

      electronMock.ipcMainListeners.get(
        "pier://window:renderer-boot-request"
      )?.({ sender: electronMock.webContents });
      const challenge = bootChallenge();
      expect(electronMock.baseWindow.show).not.toHaveBeenCalled();
      electronMock.ipcMainListeners.get("pier://window:renderer-ready")?.(
        { sender: electronMock.webContents },
        challenge
      );
      expect(electronMock.baseWindow.show).toHaveBeenCalledOnce();
    });

    it("does not report preload failure while the application is quitting", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { windowManager } = await import("@main/windows/window-manager.ts");
      windowManager.create({ id: "main" });
      Reflect.set(windowManager, "isDestroyingAllForQuit", true);

      electronMock.webListeners.get("preload-error")?.(
        undefined,
        "/missing/preload.cjs",
        new Error("preload failed")
      );
      await Promise.resolve();

      expect(electronMock.showMessageBox).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });

    it("reports an unexpected renderer exit through native recovery", async () => {
      const { windowManager } = await import("@main/windows/window-manager.ts");
      windowManager.create({ id: "main" });

      electronMock.webListeners.get("render-process-gone")?.(undefined, {
        exitCode: 9,
        reason: "crashed",
      });

      await vi.waitFor(() =>
        expect(electronMock.showMessageBox).toHaveBeenCalledWith(
          expect.objectContaining({
            detail: "crashed (exit 9)",
            type: "error",
          })
        )
      );
    });

    it("destroys the unusable window when native recovery chooses close", async () => {
      electronMock.showMessageBox.mockResolvedValueOnce({ response: 1 });
      const { windowManager } = await import("@main/windows/window-manager.ts");
      windowManager.create({ id: "main" });

      electronMock.webListeners.get("did-fail-load")?.(
        {},
        -6,
        "ERR_FILE_NOT_FOUND",
        "file:///missing/index.html",
        true
      );

      await vi.waitFor(() =>
        expect(electronMock.baseWindow.destroy).toHaveBeenCalledOnce()
      );
      expect(electronMock.webContents.reload).not.toHaveBeenCalled();
    });

    describe("destroyForTransfer", () => {
      it("destroys the window and marks transfer destroy on close callbacks", async () => {
        vi.resetModules();
        const { windowManager } = await import(
          "@main/windows/window-manager.ts"
        );
        const closed: Record<string, unknown>[] = [];
        windowManager.onClose((payload) => {
          closed.push(payload as never);
        });
        windowManager.create({ id: "main", recordId: "record-main" });
        await windowManager.destroyForTransfer(
          "main",
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        );
        electronMock.hostListeners.get("closed")?.();
        expect(electronMock.baseWindow.destroy).toHaveBeenCalled();
        expect(closed[0]).toMatchObject({
          recordId: "record-main",
          transferDestroy: true,
          windowId: "main",
        });
      });
    });
  }
);
