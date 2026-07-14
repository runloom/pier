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
import {
  NATIVE_CHROME_FALLBACK,
  TRANSPARENT_NATIVE_BACKGROUND,
} from "@shared/theme-colors.ts";
import {
  app,
  BaseWindow,
  BrowserWindow,
  nativeTheme,
  WebContentsView,
} from "electron";
import { installDetachedDevToolsHandlers } from "../devtools.ts";
import { foregroundActivityService } from "../ipc/foreground-activity.ts";
import { getTerminalAddon } from "../ipc/terminal.ts";
import { terminalFocusCoordinator } from "../ipc/terminal-focus-coordinator.ts";
import { isDevRuntime } from "../runtime-mode.ts";
import { type AppWindow, createAppWindow } from "./app-window.ts";
import { installMacAppViewGeometry } from "./mac-app-view-geometry.ts";
import {
  installRendererFailureRecovery,
  reportRendererLoadError,
} from "./renderer-failure-recovery.ts";
import { createRendererShowGate } from "./renderer-show-gate.ts";
import {
  WindowCloseCoordinator,
  type WindowCloseDecision,
  type WindowCloseResult,
} from "./window-close-coordinator.ts";
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

export type {
  WindowCloseDecision,
  WindowCloseResult,
} from "./window-close-coordinator.ts";

function resolveDevIcon(): string | undefined {
  return isDev ? join(import.meta.dirname, "../../build/icon.png") : undefined;
}

class WindowManager {
  private readonly windows = new Map<string, AppWindow>();
  private readonly allocator = new WindowIdAllocator();
  private readonly closeCoordinator = new WindowCloseCoordinator();
  private readonly onCloseCallbacks: Array<
    (payload: { recordId: string; windowId: string }) => void
  > = [];
  private readonly onFocusCallbacks: Array<
    (payload: { recordId: string; windowId: string }) => void
  > = [];
  private focusSequence = 0;
  private readonly lastFocusedAtByWindowId = new Map<string, number>();
  private isDestroyingAllForQuit = false;
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
    }) => Promise<WindowCloseDecision> | WindowCloseDecision
  ): void {
    this.closeCoordinator.onBeforeClose(callback);
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
    const preload = join(import.meta.dirname, "../preload/index.cjs");
    const webPreferences: Electron.WebPreferences = {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      additionalArguments: [`--window-id=${id}`],
    };
    const baseOpts: Electron.BaseWindowConstructorOptions = {
      width: opts.bounds?.width ?? 1280,
      height: opts.bounds?.height ?? 800,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: NATIVE_CHROME_FALLBACK[resolved],
      ...(isMac && {
        opacity: 0,
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
    const electronWindowId = window.id;
    rememberAppWindow(window, {
      mode,
      recordId: opts.recordId ?? id,
      windowId: id,
    });

    const rendererShowGate = createRendererShowGate({
      recordId: opts.recordId ?? id,
      showInactive: opts.showInactive ?? false,
      window,
      windowId: id,
    });
    const rendererFailure = installRendererFailureRecovery({
      beforeLoadFailure: rendererShowGate.cancel,
      beforeRendererGone: () => {
        rendererShowGate.cancel();
        terminalFocusCoordinator.clearWindow(electronWindowId);
        try {
          getTerminalAddon()?.closeAllTerminals(window.getNativeWindowHandle());
        } catch {
          // ignore: window 即将销毁/已销毁
        }
      },
      isQuitting: () => this.isDestroyingAllForQuit,
      retryRenderer: rendererShowGate.retry,
      window,
    });
    if (isMac) {
      // BaseWindow + WebContentsView 在完全隐藏时不会激活首个 renderer。
      // 以透明、非激活窗口启动进程，真正可见性仍由 rendererShowGate 掌控。
      window.host.showInactive();
    }
    rendererShowGate.setReadyTimeoutHandler(() => {
      rendererFailure.report({
        detail: "renderer did not signal readiness before the startup deadline",
        kind: "load",
      });
    });
    window.host.on("blur", () => {
      terminalFocusCoordinator.setWindowFocused(window, false, "window-blur");
    });
    // BrowserWindow resignKey 时 Ghostty 库的 windowDidResignKey 会把每个 surface
    // 的 core.setFocus(false), cursor 变空心、shell 不接 stdin. becomeKey 只在
    // firstResponder === self 时才 setFocus(true), 而我们在 blur 时已把 swift state
    // 改成 web/null + main 端的 active terminal panel 记忆停留在 map 中, AppKit
    // firstResponder 在跨 app switch 后也未必仍指向之前的 terminalView. 这里在 focus
    // 事件主动 replay user 最后期望的键盘目标；main 会重新应用输入路由快照，
    // swift 端再按 keyboardFocusTarget 恢复 first responder。
    window.host.on("focus", () => {
      this.rememberFocusedWindow(id);
      terminalFocusCoordinator.setWindowFocused(window, true, "window-focus");
      const context = findWindowContext(window);
      if (context) {
        for (const cb of this.onFocusCallbacks) {
          cb({ recordId: context.recordId, windowId: id });
        }
      }
    });

    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });

    if (isDev) {
      installDetachedDevToolsHandlers(window, () => {
        terminalFocusCoordinator.setWindowFocused(window, true, "window-focus");
      });
    }

    window.host.on("close", (event: Electron.Event) => {
      const context = findWindowContext(window);
      if (
        !this.isDestroyingAllForQuit &&
        context &&
        this.closeCoordinator.intercept(window, id, {
          recordId: context.recordId,
          windowId: id,
        })
      ) {
        event.preventDefault();
        return;
      }
      terminalFocusCoordinator.clearWindow(electronWindowId);
      try {
        getTerminalAddon()?.detachWindow(window.getNativeWindowHandle());
      } catch {
        // handle 可能已失效 — addon dict 会自然 stale, process 退出时全部释放
      }
    });

    window.host.on("closed", () => {
      rendererShowGate.cancel();
      terminalFocusCoordinator.clearWindow(electronWindowId);
      // 整窗关闭绕过 renderer 逐 panel 关闭 IPC——在此兜底清理 agent 会话,
      // 否则条目永久残留（幽灵 TitleBar 计数）。BaseWindow 不触发
      // app "browser-window-created"/BrowserWindow 事件, 只能挂在这里。
      foregroundActivityService.windowClosed(String(electronWindowId));
      if (window.appView && !window.webContents.isDestroyed()) {
        window.webContents.close();
      }
      const context = findWindowContext(window);
      forgetAppWindow(window);
      this.windows.delete(id);
      this.closeCoordinator.resolve(id, "closed");
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
      window.webContents.loadURL(rendererUrl).catch((error: unknown) => {
        reportRendererLoadError(rendererFailure, error);
      });
    } else {
      window.webContents
        .loadFile(join(import.meta.dirname, "../renderer/index.html"))
        .catch((error: unknown) => {
          reportRendererLoadError(rendererFailure, error);
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

  private createMacWindow(
    baseOpts: Electron.BaseWindowConstructorOptions,
    webPreferences: Electron.WebPreferences
  ): AppWindow {
    const host = new BaseWindow(baseOpts);
    const appView = new WebContentsView({ webPreferences });
    appView.setBackgroundColor(TRANSPARENT_NATIVE_BACKGROUND);
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
    if (process.platform === "darwin") {
      app.focus?.({ steal: true });
    }
    this.rememberFocusedWindow(id);
    w.focus();
    terminalFocusCoordinator.setWindowFocused(w, true, "window-focus");
  }

  close(id: string): Promise<WindowCloseResult> {
    const window = this.windows.get(id);
    if (!window) {
      return Promise.resolve("not-found");
    }
    return this.closeCoordinator.wait(id, window);
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

  isQuitting(): boolean {
    return this.isDestroyingAllForQuit;
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
