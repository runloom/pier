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
import { getTerminalAddon } from "../ipc/terminal.ts";
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

class WindowManager {
  private readonly windows = new Map<string, BrowserWindow>();
  private readonly allocator = new WindowIdAllocator();
  private readonly onCloseCallbacks: Array<(windowId: string) => void> = [];

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

    // renderer reload / crash 时清理 terminal NSView, 防止旧 view 残留在
    // contentView.subviews 中导致 layer 泄漏. React TerminalPanel useEffect cleanup
    // 在 reload 时来不及发出 close IPC.
    //
    // 检测策略: did-finish-load 标记首次加载完成, 之后再 did-start-loading 视为 reload.
    // 加 render-process-gone 处理 crash. swift createTerminal idempotent 是兜底.
    const closeAllTerminalsForWindow = () => {
      try {
        getTerminalAddon()?.closeAllTerminals(window.getNativeWindowHandle());
      } catch {
        // ignore: window 即将销毁/已销毁
      }
    };
    let hasFinishedFirstLoad = false;
    window.webContents.on("did-finish-load", () => {
      hasFinishedFirstLoad = true;
    });
    window.webContents.on("did-start-loading", () => {
      if (hasFinishedFirstLoad) {
        closeAllTerminalsForWindow();
      }
    });
    window.webContents.on("render-process-gone", closeAllTerminalsForWindow);

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
