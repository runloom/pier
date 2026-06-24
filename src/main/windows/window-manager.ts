/**
 * WindowManager — 多窗口生命周期管理.
 *
 * 从 loomdesk 精简移植: 保留 create/list/focus/close + ID 分配, 去掉 PTY 迁移 /
 * close-guard 两段式 / route pending / reload detach 等 pier 暂不需要的能力.
 *
 *   - create(): 分配 id (首窗口 "main", 后续 w-{N}), 创建 BrowserWindow, 注册到 Map.
 *   - list(): 返回所有存活窗口的 { id, focused }.
 *   - focus(): 聚焦/恢复指定窗口.
 *   - close(): 关闭指定窗口.
 *   - onClose(): 关闭回调 (供 main 侧清理).
 *
 * 窗口关闭后自动从 Map 移除并释放 ID; window-all-closed 由 main 侧处理.
 */
import { join } from "node:path";
import { app, BrowserWindow, nativeTheme, shell } from "electron";
import { installDetachedDevToolsHandlers } from "../devtools.ts";
import { getTerminalAddon, restoreActivePanelFocus } from "../ipc/terminal.ts";
import { WindowIdAllocator } from "./window-id-allocator.ts";

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

/** macOS reload 期间临时用于覆盖非终端区域的 chrome 色 fallback (跟 windowed
 *  默认 dark 一致). renderer hydrate 完会调 setNativeChrome 推真实 chrome 色, 这里
 *  只在 setNativeChrome 还没到 (首次启动) 时兜底. */
const RELOAD_CHROME_FALLBACK_MAC = "#1e1e1e";

class WindowManager {
  private readonly windows = new Map<string, BrowserWindow>();
  private readonly allocator = new WindowIdAllocator();
  private readonly onCloseCallbacks: Array<(windowId: string) => void> = [];
  /** macOS reload 期间临时切的 chrome 色, 每窗口独立 (多窗口主题可独立). */
  private readonly reloadChromeColor = new WeakMap<BrowserWindow, string>();

  /**
   * 由 theme IPC 调:记录该 window 当前的 chrome 色 (sidebar/titlebar 同款),
   * 供 reload 期间临时覆盖非终端区域用. 不立刻 setBackgroundColor — 平时窗口
   * 必须保持 #00000000 透明让 terminal NSView 透出. 只在 did-start-loading →
   * did-finish-load 窗口期短暂切换.
   */
  setReloadChromeColor(window: BrowserWindow, color: string): void {
    this.reloadChromeColor.set(window, color);
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
    const winOpts: Electron.BrowserWindowConstructorOptions = {
      width: opts.bounds?.width ?? 1280,
      height: opts.bounds?.height ?? 800,
      show: false,
      autoHideMenuBar: true,
      transparent: isMac,
      backgroundColor: isMac ? "#00000000" : bgPalette[resolved],
      ...(isMac && {
        titleBarStyle: "hiddenInset" as const,
        trafficLightPosition: { x: 12, y: 12 },
      }),
      webPreferences: {
        preload: join(import.meta.dirname, "../preload/index.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        additionalArguments: [`--window-id=${id}`],
      },
    };
    if (opts.bounds?.x !== undefined) {
      winOpts.x = opts.bounds.x;
    }
    if (opts.bounds?.y !== undefined) {
      winOpts.y = opts.bounds.y;
    }
    const devIcon = resolveDevIcon();
    if (!isMac && devIcon) {
      winOpts.icon = devIcon;
    }

    const window = new BrowserWindow(winOpts);

    window.on("ready-to-show", () => window.show());

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
    // BrowserWindow.contentView 是 native subview 关系, webContents reload 不动它;
    // 新 renderer mount 后会调 terminal.reconcile(activeIds) 主动清差集, terminal
    // panel 的 PTY / session / 屏幕内容跨 reload 完整保留 (零闪烁 + 不丢 shell 状态).
    window.webContents.on("render-process-gone", () => {
      try {
        getTerminalAddon()?.closeAllTerminals(window.getNativeWindowHandle());
      } catch {
        // ignore: window 即将销毁/已销毁
      }
    });

    // macOS reload 非终端区域闪烁修复:
    //
    // BrowserWindow 平时 backgroundColor=#00000000 (透明), 让 terminal NSView 从
    // contentView.subviews[0] 透出. reload 期间 WKWebView 短暂卸载, 非终端区域
    // 没有 web 内容铺底, 透明窗口直接透到桌面 → 视觉上"非终端区域闪一下".
    //
    // 修复:did-start-loading 把 backgroundColor 临时切到当前 chrome 色 (sidebar/
    // titlebar 同款的 --muted), did-finish-load 再切回透明. 反正 reload 完成后
    // web 层会覆盖整个非终端区域, chrome 色一闪即被覆盖, 视觉上无感.
    //
    // terminal NSView 在 NSWindow backing 之上 (它是 contentView 的 subview),
    // 临时 backgroundColor 不会遮挡它 — 但若实测发现遮挡, 退路是在 web 端 reload
    // 前先把 NSView 主动 hide, 再 reload, 切回时 show. 当前实测以无遮挡为前提.
    if (isMac) {
      let hasFinishedFirstLoad = false;
      window.webContents.on("did-finish-load", () => {
        hasFinishedFirstLoad = true;
        try {
          window.setBackgroundColor("#00000000");
        } catch {
          // ignore: window 即将销毁
        }
      });
      window.webContents.on("did-start-loading", () => {
        if (!hasFinishedFirstLoad) {
          return; // 首次加载不动 — 透明窗口背景下 splash 阶段不需要 chrome 色
        }
        const chromeColor =
          this.reloadChromeColor.get(window) ?? RELOAD_CHROME_FALLBACK_MAC;
        try {
          window.setBackgroundColor(chromeColor);
        } catch {
          // ignore: window 即将销毁
        }
      });
    }

    // Window 即将销毁: 在 handle 失效前抢先 detach native 资源 (closeAll + 卸
    // EventRouter + 卸 NSEvent monitor). 用 `close` 而非 `closed` 因为 `closed`
    // 时 getNativeWindowHandle 已不可访问.
    //
    // 不 detach 的话:
    // - NSEvent application-level monitor 永远活在 process 里 (内存泄漏)
    // - GhosttyBridgeImpl.eventRouters dict 累积已死 window 的 router 引用
    window.on("close", () => {
      try {
        getTerminalAddon()?.detachWindow(window.getNativeWindowHandle());
      } catch {
        // handle 可能已失效 — addon dict 会自然 stale, process 退出时全部释放
      }
    });

    window.on("closed", () => {
      for (const cb of this.onCloseCallbacks) {
        cb(id);
      }
      this.windows.delete(id);
      this.allocator.release(id);
    });

    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (isDev && rendererUrl) {
      window.loadURL(rendererUrl).catch(() => {
        // ignore: load 失败由 ready-to-show / did-fail-load 兜底
      });
    } else {
      window
        .loadFile(join(import.meta.dirname, "../renderer/index.html"))
        .catch(() => {
          // ignore: load 失败由 ready-to-show / did-fail-load 兜底
        });
    }

    this.windows.set(id, window);
    return id;
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

  get(id: string): BrowserWindow | undefined {
    return this.windows.get(id);
  }

  getAll(): BrowserWindow[] {
    return [...this.windows.values()];
  }

  /** 通过 BrowserWindow 实例反查内部 string id. */
  findInternalIdByBrowserWindow(bw: BrowserWindow): string | null {
    for (const [id, w] of this.windows) {
      if (w === bw) {
        return id;
      }
    }
    return null;
  }
}

export const windowManager = new WindowManager();
