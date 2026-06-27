/**
 * WindowManager — 多窗口生命周期管理.
 *
 * 从 loomdesk 精简移植: 保留 create/list/focus/close + ID 分配, 去掉 PTY 迁移 /
 * close-guard 两段式 / route pending / reload detach 等 pier 暂不需要的能力.
 *
 *   - create(): 分配 id (首窗口 "main", 后续 w-{N}), 创建 app window, 注册到 Map.
 *   - list(): 返回所有存活窗口的 { id, recordId, focused }.
 *   - focus(): 聚焦/恢复指定窗口.
 *   - close(): 关闭指定窗口.
 *   - onClose(): 关闭回调 (供 main 侧清理).
 *
 * 窗口关闭后自动从 Map 移除并释放 ID; window-all-closed 由 main 侧处理.
 */
import { join } from "node:path";
import type { WindowOpenMode } from "@shared/contracts/window.ts";
import { PIER } from "@shared/ipc-channels.ts";
import {
  BaseWindow,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  shell,
  WebContentsView,
} from "electron";
import { installDetachedDevToolsHandlers } from "../devtools.ts";
import { getTerminalAddon } from "../ipc/terminal.ts";
import {
  blurActivePanelFocus,
  restoreActivePanelFocus,
} from "../ipc/terminal-focus-state.ts";
import { isDevRuntime } from "../runtime-mode.ts";
import { type AppWindow, createAppWindow } from "./app-window.ts";
import { installMacAppViewGeometry } from "./mac-app-view-geometry.ts";
import { WindowIdAllocator } from "./window-id-allocator.ts";
import {
  findAppWindowByWebContents,
  findInternalWindowId,
  findWindowContext,
  forgetAppWindow,
  rememberAppWindow,
} from "./window-identity.ts";

const WINDOW_ID_REGEX = /^(main|w-\d+)$/;

export interface WindowBounds {
  height?: number;
  width?: number;
  x?: number;
  y?: number;
}

export interface CreateWindowOptions {
  bounds?: WindowBounds;
  id?: string;
  mode?: WindowOpenMode;
  recordId?: string;
  showInactive?: boolean;
}

export interface WindowInfo {
  focused: boolean;
  id: string;
  lastFocusedAt?: number;
  recordId: string;
}

const isDev = isDevRuntime();
const isMac = process.platform === "darwin";
const RENDERER_READY_SHOW_TIMEOUT_MS = 3000;

function resolveDevIcon(): string | undefined {
  return isDev ? join(import.meta.dirname, "../../build/icon.png") : undefined;
}

class WindowManager {
  private readonly windows = new Map<string, AppWindow>();
  private readonly allocator = new WindowIdAllocator();
  private readonly onBeforeCloseCallbacks: Array<
    (payload: { recordId: string; windowId: string }) => Promise<void> | void
  > = [];
  private readonly onCloseCallbacks: Array<
    (payload: { recordId: string; windowId: string }) => void
  > = [];
  private readonly onFocusCallbacks: Array<
    (payload: { recordId: string; windowId: string }) => void
  > = [];
  private focusSequence = 0;
  private readonly lastFocusedAtByWindowId = new Map<string, number>();
  private isDestroyingAllForQuit = false;
  private readonly closeFlushDone = new WeakSet<AppWindow>();
  private readonly closeFlushPending = new WeakSet<AppWindow>();
  private readonly onCreateCallbacks: Array<
    (payload: { recordId: string; window: AppWindow; windowId: string }) => void
  > = [];

  setNativeChromeColor(window: AppWindow, color: string): void {
    if (isMac) {
      window.setBackgroundColor(color);
    }
  }

  onClose(
    callback: (payload: { recordId: string; windowId: string }) => void
  ): void {
    this.onCloseCallbacks.push(callback);
  }

  onCreate(
    callback: (payload: {
      recordId: string;
      window: AppWindow;
      windowId: string;
    }) => void
  ): void {
    this.onCreateCallbacks.push(callback);
  }

  onFocus(
    callback: (payload: { recordId: string; windowId: string }) => void
  ): void {
    this.onFocusCallbacks.push(callback);
  }

  onBeforeClose(
    callback: (payload: {
      recordId: string;
      windowId: string;
    }) => Promise<void> | void
  ): void {
    this.onBeforeCloseCallbacks.push(callback);
  }

  private rememberFocusedWindow(windowId: string): number {
    this.focusSequence += 1;
    this.lastFocusedAtByWindowId.set(windowId, this.focusSequence);
    return this.focusSequence;
  }

  create(opts: CreateWindowOptions = {}): string {
    const id = opts.id ?? this.allocator.next();
    const mode = opts.mode ?? "restore";
    if (!WINDOW_ID_REGEX.test(id)) {
      throw new Error(`invalid windowId: ${JSON.stringify(id)}`);
    }
    if (this.windows.has(id)) {
      throw new Error(`window id collision: ${JSON.stringify(id)}`);
    }

    const resolved: "light" | "dark" = nativeTheme.shouldUseDarkColors
      ? "dark"
      : "light";
    const bgPalette: Record<"light" | "dark", string> = {
      light: "#ffffff",
      dark: "#1e1e1e",
    };
    const preload = join(import.meta.dirname, "../preload/index.cjs");
    const webPreferences: Electron.WebPreferences = {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--window-id=${id}`],
    };
    const baseOpts: Electron.BaseWindowConstructorOptions = {
      width: opts.bounds?.width ?? 1280,
      height: opts.bounds?.height ?? 800,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: bgPalette[resolved],
      ...(isMac && {
        titleBarStyle: "hiddenInset" as const,
        trafficLightPosition: { x: 12, y: 12 },
      }),
    };
    if (opts.bounds?.x !== undefined) {
      baseOpts.x = opts.bounds.x;
    }
    if (opts.bounds?.y !== undefined) {
      baseOpts.y = opts.bounds.y;
    }
    const devIcon = resolveDevIcon();
    const window = isMac
      ? this.createMacWindow(baseOpts, webPreferences)
      : this.createBrowserWindow(baseOpts, webPreferences, devIcon);
    rememberAppWindow(window, {
      mode,
      recordId: opts.recordId ?? id,
      sessionId: opts.recordId ?? id,
      windowId: id,
    });

    let didShow = false;
    let showFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const traceStartup = (
      event: "did-finish-load" | "fallback" | "readyToShow" | "show",
      extra: Record<string, unknown> = {}
    ) => {
      if (process.env.PIER_STARTUP_TRACE !== "1") {
        return;
      }
      console.info("[window-startup]", {
        event,
        recordId: opts.recordId ?? id,
        windowId: id,
        ...extra,
      });
    };
    const cleanupShowWait = () => {
      if (showFallbackTimer) {
        clearTimeout(showFallbackTimer);
        showFallbackTimer = null;
      }
      ipcMain.off(PIER.WINDOW_RENDERER_READY, handleRendererReady);
    };
    const showOnce = () => {
      if (didShow) {
        return;
      }
      didShow = true;
      cleanupShowWait();
      if (!window.isDestroyed()) {
        const showMode = opts.showInactive ? "inactive" : "active";
        traceStartup("show", { showMode });
        if (opts.showInactive) {
          window.host.showInactive();
        } else {
          window.host.show();
        }
      }
    };
    const handleRendererReady = (event: Electron.IpcMainEvent) => {
      if (event.sender !== window.webContents) {
        return;
      }
      traceStartup("readyToShow");
      showOnce();
    };
    const scheduleReadyFallback = () => {
      traceStartup("did-finish-load");
      if (!showFallbackTimer) {
        showFallbackTimer = setTimeout(() => {
          const payload = {
            recordId: opts.recordId ?? id,
            showMode: opts.showInactive ? "inactive" : "active",
            windowId: id,
          };
          console.warn("[window-startup] readyToShow fallback", payload);
          traceStartup("fallback", payload);
          showOnce();
        }, RENDERER_READY_SHOW_TIMEOUT_MS);
      }
    };
    ipcMain.on(PIER.WINDOW_RENDERER_READY, handleRendererReady);
    window.webContents.once("did-finish-load", scheduleReadyFallback);
    window.webContents.once("did-fail-load", showOnce);
    window.host.on("blur", () => {
      blurActivePanelFocus(window);
    });
    // BrowserWindow resignKey 时 Ghostty 库的 windowDidResignKey 会把每个 surface
    // 的 core.setFocus(false), cursor 变空心、shell 不接 stdin. becomeKey 只在
    // firstResponder === self 时才 setFocus(true), 而我们在 blur 时已把 swift state
    // 改成 web/null + main 端的 active terminal panel 记忆停留在 map 中, AppKit
    // firstResponder 在跨 app switch 后也未必仍指向之前的 terminalView. 这里在 focus
    // 事件主动 replay user 最后期望的 active panel — swift 端 focusTerminal 会重新
    // makeFirstResponder + 强制 becomeFirstResponder, 让 Ghostty surface focus 回到 true.
    window.host.on("focus", () => {
      this.rememberFocusedWindow(id);
      restoreActivePanelFocus(window);
      const context = findWindowContext(window);
      if (context) {
        for (const cb of this.onFocusCallbacks) {
          cb({ recordId: context.recordId, windowId: id });
        }
      }
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url).catch(() => {
        // ignore: 外部 URL 打开失败由 OS 处理
      });
      return { action: "deny" };
    });

    if (isDev) {
      installDetachedDevToolsHandlers(window, () => {
        restoreActivePanelFocus(window);
      });
    }

    // Crash 兜底: 渲染进程异常退出 (非主动 reload) 时清理 terminal NSView, 防止
    // 旧 view 残留在 contentView.subviews 中. 正常 reload 不在这里清 — NSView 跟
    // NSWindow.contentView 是 native subview 关系, webContents reload 不动它; 新
    // renderer mount 后会调 terminal.reconcile(activeIds) 主动清差集.
    window.webContents.on("render-process-gone", () => {
      try {
        getTerminalAddon()?.closeAllTerminals(window.getNativeWindowHandle());
      } catch {
        // ignore: window 即将销毁/已销毁
      }
    });
    window.webContents.on("preload-error", (_event, preloadPath, error) => {
      console.error(
        "[pier-preload-error]",
        preloadPath,
        error instanceof Error ? error.message : String(error)
      );
    });

    // Window 即将销毁: 在 handle 失效前抢先 detach native 资源 (closeAll + 卸
    // EventRouter + 卸 NSEvent monitor). 用 `close` 而非 `closed` 因为 `closed`
    // 时 getNativeWindowHandle 已不可访问.
    //
    // 不 detach 的话:
    // - NSEvent application-level monitor 永远活在 process 里 (内存泄漏)
    // - GhosttyBridgeImpl.eventRouters dict 累积已死 window 的 router 引用
    window.host.on("close", (event: Electron.Event) => {
      const context = findWindowContext(window);
      if (
        !this.isDestroyingAllForQuit &&
        context &&
        !this.closeFlushDone.has(window)
      ) {
        event.preventDefault();
        if (!this.closeFlushPending.has(window)) {
          this.closeFlushPending.add(window);
          this.flushBeforeClose(window, {
            recordId: context.recordId,
            windowId: id,
          }).finally(() => {
            this.closeFlushPending.delete(window);
            this.closeFlushDone.add(window);
            if (!window.isDestroyed()) {
              window.close();
            }
          });
        }
        return;
      }
      try {
        getTerminalAddon()?.detachWindow(window.getNativeWindowHandle());
      } catch {
        // handle 可能已失效 — addon dict 会自然 stale, process 退出时全部释放
      }
    });

    window.host.on("closed", () => {
      cleanupShowWait();
      if (window.appView && !window.webContents.isDestroyed()) {
        window.webContents.close();
      }
      const context = findWindowContext(window);
      forgetAppWindow(window);
      this.windows.delete(id);
      this.lastFocusedAtByWindowId.delete(id);
      this.allocator.release(id);
      if (!this.isDestroyingAllForQuit && context) {
        for (const cb of this.onCloseCallbacks) {
          cb({ recordId: context.recordId, windowId: id });
        }
      }
    });

    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (isDev && rendererUrl) {
      window.webContents.loadURL(rendererUrl).catch(() => {
        // ignore: load 失败由 ready-to-show / did-fail-load 兜底
      });
    } else {
      window.webContents
        .loadFile(join(import.meta.dirname, "../renderer/index.html"))
        .catch(() => {
          // ignore: load 失败由 ready-to-show / did-fail-load 兜底
        });
    }

    this.windows.set(id, window);
    for (const cb of this.onCreateCallbacks) {
      cb({
        recordId: opts.recordId ?? id,
        window,
        windowId: id,
      });
    }
    return id;
  }

  private async flushBeforeClose(
    window: AppWindow,
    payload: { recordId: string; windowId: string }
  ): Promise<void> {
    try {
      await Promise.all(this.onBeforeCloseCallbacks.map((cb) => cb(payload)));
    } catch (err) {
      console.error(
        "[window-before-close] failed:",
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      this.closeFlushPending.delete(window);
    }
  }

  private createMacWindow(
    baseOpts: Electron.BaseWindowConstructorOptions,
    webPreferences: Electron.WebPreferences
  ): AppWindow {
    const host = new BaseWindow(baseOpts);
    const appView = new WebContentsView({ webPreferences });
    appView.setBackgroundColor("#00000000");
    host.contentView.addChildView(appView);
    installMacAppViewGeometry(host, appView);
    return createAppWindow(host, appView.webContents, appView);
  }

  private createBrowserWindow(
    baseOpts: Electron.BaseWindowConstructorOptions,
    webPreferences: Electron.WebPreferences,
    devIcon: string | undefined
  ): AppWindow {
    const browserOpts: Electron.BrowserWindowConstructorOptions = {
      ...baseOpts,
      ...(devIcon ? { icon: devIcon } : {}),
      webPreferences,
    };
    const host = new BrowserWindow(browserOpts);
    return createAppWindow(host, host.webContents, null);
  }

  list(): WindowInfo[] {
    return [...this.windows.entries()].map(([id, w]) => {
      const lastFocusedAt = this.lastFocusedAtByWindowId.get(id);
      return {
        id,
        focused: w.isFocused(),
        ...(lastFocusedAt === undefined ? {} : { lastFocusedAt }),
        recordId: findWindowContext(w)?.recordId ?? id,
      };
    });
  }

  focus(id: string): void {
    const w = this.windows.get(id);
    if (!w) {
      return;
    }
    if (w.isMinimized()) {
      w.restore();
    }
    this.rememberFocusedWindow(id);
    w.focus();
  }

  close(id: string): void {
    this.windows.get(id)?.close();
  }

  destroyAllForQuit(): void {
    this.isDestroyingAllForQuit = true;
    for (const window of this.windows.values()) {
      if (!window.isDestroyed()) {
        try {
          getTerminalAddon()?.detachWindow(window.getNativeWindowHandle());
        } catch {
          // ignore: app 正在退出
        }
        if (window.appView && !window.webContents.isDestroyed()) {
          window.webContents.close();
        }
        window.destroy();
      }
    }
  }

  get(id: string): AppWindow | undefined {
    return this.windows.get(id);
  }

  getAll(): AppWindow[] {
    return [...this.windows.values()];
  }

  getFocused(): AppWindow | null {
    return this.getAll().find((win) => win.isFocused()) ?? null;
  }

  fromWebContents(webContents: Electron.WebContents): AppWindow | null {
    return findAppWindowByWebContents(webContents);
  }

  /** 通过 AppWindow 实例反查内部 string id. */
  findInternalIdByWindow(window: AppWindow): string | null {
    return findInternalWindowId(window);
  }
}

export const windowManager = new WindowManager();
