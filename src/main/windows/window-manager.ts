/**
 * WindowManager — 多窗口生命周期管理.
 *
 * 从 loomdesk 精简移植: 保留 create/list/focus/close + ID 分配, 去掉 PTY 迁移 /
 * close-guard 两段式 / route pending / reload detach 等 pier 暂不需要的能力.
 *
 *   - create(): 分配 id (首窗口 "main", 后续 w-{N}), 创建 app window, 注册到 Map.
 *   - list(): 返回所有存活窗口的 { id, focused }.
 *   - focus(): 聚焦/恢复指定窗口.
 *   - close(): 关闭指定窗口.
 *   - onClose(): 关闭回调 (供 main 侧清理).
 *
 * 窗口关闭后自动从 Map 移除并释放 ID; window-all-closed 由 main 侧处理.
 */
import { join } from "node:path";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import {
  app,
  BaseWindow,
  BrowserWindow,
  nativeTheme,
  shell,
  WebContentsView,
} from "electron";
import { installDetachedDevToolsHandlers } from "../devtools.ts";
import {
  blurActivePanelFocus,
  getTerminalAddon,
  restoreActivePanelFocus,
} from "../ipc/terminal.ts";
import { type AppWindow, createAppWindow } from "./app-window.ts";
import { WindowIdAllocator } from "./window-id-allocator.ts";
import {
  findAppWindowByWebContents,
  findInternalWindowId,
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
}

export interface WindowInfo {
  focused: boolean;
  id: string;
}

const isDev = !app.isPackaged;
const isMac = process.platform === "darwin";

function resolveDevIcon(): string | undefined {
  return isDev ? join(import.meta.dirname, "../../build/icon.png") : undefined;
}

class WindowManager {
  private readonly windows = new Map<string, AppWindow>();
  private readonly allocator = new WindowIdAllocator();
  private readonly onCloseCallbacks: Array<(windowId: string) => void> = [];

  setNativeChromeColor(window: AppWindow, color: string): void {
    if (isMac) {
      window.setBackgroundColor(color);
    }
  }

  onClose(callback: (windowId: string) => void): void {
    this.onCloseCallbacks.push(callback);
  }

  create(opts: CreateWindowOptions = {}): string {
    const id = opts.id ?? this.allocator.next();
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
    rememberAppWindow(window, id);

    const showOnce = () => {
      if (!window.isDestroyed()) {
        window.host.show();
      }
    };
    window.webContents.once("did-finish-load", showOnce);
    window.webContents.once("did-fail-load", showOnce);
    window.host.on("blur", () => {
      blurActivePanelFocus(window);
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
    window.host.on("close", () => {
      try {
        getTerminalAddon()?.detachWindow(window.getNativeWindowHandle());
      } catch {
        // handle 可能已失效 — addon dict 会自然 stale, process 退出时全部释放
      }
    });

    window.host.on("closed", () => {
      if (window.appView && !window.webContents.isDestroyed()) {
        window.webContents.close();
      }
      forgetAppWindow(window);
      this.windows.delete(id);
      this.allocator.release(id);
      for (const cb of this.onCloseCallbacks) {
        cb(id);
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
    return id;
  }

  private createMacWindow(
    baseOpts: Electron.BaseWindowConstructorOptions,
    webPreferences: Electron.WebPreferences
  ): AppWindow {
    const host = new BaseWindow(baseOpts);
    const appView = new WebContentsView({ webPreferences });
    appView.setBackgroundColor("#00000000");
    host.contentView.addChildView(appView);
    const resizeAppView = () => {
      const [width = 0, height = 0] = host.getContentSize();
      appView.setBounds({ x: 0, y: 0, width, height });
    };
    const sendLayoutPulse = (reason: "resize" | "zoom") => {
      if (!appView.webContents.isDestroyed()) {
        appView.webContents.send(PIER_BROADCAST.WINDOW_LAYOUT_PULSE, {
          reason,
        });
      }
    };
    resizeAppView();
    host.on("resize", () => {
      resizeAppView();
      sendLayoutPulse("resize");
    });
    host.on("resized", () => sendLayoutPulse("resize"));
    host.on("maximize", () => sendLayoutPulse("zoom"));
    host.on("unmaximize", () => sendLayoutPulse("zoom"));
    host.on("enter-full-screen", () => sendLayoutPulse("zoom"));
    host.on("leave-full-screen", () => sendLayoutPulse("zoom"));
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
    return [...this.windows.entries()].map(([id, w]) => ({
      id,
      focused: w.isFocused(),
    }));
  }

  focus(id: string): void {
    const w = this.windows.get(id);
    if (!w) {
      return;
    }
    if (w.isMinimized()) {
      w.restore();
    }
    w.focus();
  }

  close(id: string): void {
    this.windows.get(id)?.close();
  }

  destroyAllForQuit(): void {
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
