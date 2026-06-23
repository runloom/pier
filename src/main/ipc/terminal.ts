import { createRequire } from "node:module";
import type {
  CreateTerminalArgs,
  TerminalColors,
  TerminalFrame,
} from "@shared/contracts/terminal.ts";
import { BrowserWindow, type IpcMain } from "electron";

interface NativeAddon {
  /**
   * 应用 Pier 主题派生的终端配色到指定 window 下的 Ghostty controller.
   * Ghostty 库 controller.setTheme(...) 内部 reconfigure 并立即生效, shell 进程
   * 不重启. 每个 BrowserWindow 一个 controller, 该 window 下所有 terminal panel
   * 共享, 调一次即可.
   */
  applyTerminalTheme(parentHandle: Buffer, colors: TerminalColors): void;
  closeAllTerminals(parentHandle: Buffer): void;
  closeTerminal(panelId: string): void;
  createTerminal(
    parentHandle: Buffer,
    panelId: string,
    frame: TerminalFrame
  ): boolean;
  /** Window 真正销毁时调用一次: closeAll + 卸 EventRouter + 卸 NSEvent monitor */
  detachWindow(parentHandle: Buffer): void;
  focusTerminal(panelId: string): void;
  hideTerminal(panelId: string): void;
  /**
   * 注册 keyboard forward callback. swift NSEvent monitor 检测 Cmd+key 后调用,
   * 传 (browserWindowId, modifierFlags, chars). browserWindowId 是 setupWindow
   * 传入的 BrowserWindow.id, 用于多窗口路由. 传 null 解绑.
   */
  setActivePanelKind(
    parentHandle: Buffer,
    kindRaw: number,
    panelId: string | null
  ): void;
  setFrame(panelId: string, frame: TerminalFrame): void;
  setKeyboardForwardCallback(
    cb:
      | ((
          browserWindowId: number,
          modifierFlags: number,
          chars: string
        ) => void)
      | null
  ): void;
  setOverlayActive(parentHandle: Buffer, active: boolean): void;
  setupWindow(parentHandle: Buffer, browserWindowId: number): boolean;
  showTerminal(panelId: string): void;
}

/** 暴露给 window-manager 在 renderer reload/crash 时调用清理. */
export function getTerminalAddon(): NativeAddon | null {
  return cachedAddon;
}

let cachedAddon: NativeAddon | null = null;

function loadNativeAddon(): {
  addon: NativeAddon | null;
  error: string | null;
} {
  if (process.platform !== "darwin") {
    return { addon: null, error: "ghostty requires macOS" };
  }
  try {
    const require = createRequire(import.meta.url);
    const addon: NativeAddon = require("../../native/build/Release/ghostty_native.node");
    return { addon, error: null };
  } catch (e) {
    return {
      addon: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function registerTerminalIpc(ipcMain: IpcMain): void {
  const { addon, error: loadError } = loadNativeAddon();
  cachedAddon = addon;

  // 注册 keyboard forward callback: swift NSEvent monitor 捕获 Cmd+key 后,
  // 通过 ThreadSafeFunction 调到这里. callback 收到 (browserWindowId, modifierFlags,
  // chars), 用 windowId 精准路由到对应 BrowserWindow 的 renderer.
  //
  // 多窗口: 不能用 BrowserWindow.getFocusedWindow() —  swift NSEvent monitor 与
  // main 主线程不同, callback 执行时 focused window 可能已切换, 会把 window-A 的
  // keystroke 错送到 window-B. 用 windowId 是唯一可靠路由.
  //
  // 这是 Pier "terminal 透明 + web overlay" 架构里 keyboard 全局快捷键唯一可靠
  // 路径 — 不能用 wk.keyDown forward (Electron 42 ViewsCompositorSuperview 架构
  // 下 WKWebView 不是真正渲染 web 的层) 也不能依赖 firstResponder chain (Ghostty
  // terminalView focus 时消费所有 key).
  addon?.setKeyboardForwardCallback((browserWindowId, modifierFlags, chars) => {
    try {
      const targetWindow = BrowserWindow.fromId(browserWindowId);
      if (!targetWindow || targetWindow.isDestroyed()) {
        return;
      }
      const wc = targetWindow.webContents;
      if (wc.isDestroyed()) {
        return;
      }
      wc.send("pier:keybinding:forward", { modifierFlags, chars });
    } catch (err) {
      // window 在 send 瞬间销毁等 edge case — 不影响其他功能
      console.error("[pier-key-forward] send failed:", err);
    }
  });

  ipcMain.handle("pier:terminal:setup", (event) => {
    if (!addon) {
      return { ok: false, error: loadError ?? "native addon not loaded" };
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { ok: false, error: "window not found" };
    }
    try {
      // Electron API: 窗口背景透明 (CSS 控制哪些区域透视, 非终端区域自行画不透明背景)
      win.setBackgroundColor("#00000000");
      const handle = win.getNativeWindowHandle();
      // 把 BrowserWindow.id 传给 swift, 让 forward callback 能按 window 路由 (多窗口
      // 下避免 getFocusedWindow 误把 background window 的 keystroke 路由到 focused)
      const ok = addon.setupWindow(handle, win.id);
      return ok ? { ok: true } : { ok: false, error: "setupWindow failed" };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("pier:terminal:create", (event, args: CreateTerminalArgs) => {
    if (!addon) {
      return { ok: false, error: loadError ?? "native addon not loaded" };
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { ok: false, error: "window not found" };
    }
    try {
      const handle = win.getNativeWindowHandle();
      const ok = addon.createTerminal(handle, args.panelId, args.frame);
      return ok
        ? { ok: true }
        : { ok: false, error: "createTerminal returned false" };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

  ipcMain.on(
    "pier:terminal:set-frame",
    (_event, panelId: string, frame: TerminalFrame) => {
      addon?.setFrame(panelId, frame);
    }
  );

  ipcMain.on("pier:terminal:show", (_event, panelId: string) => {
    addon?.showTerminal(panelId);
  });

  ipcMain.on("pier:terminal:hide", (_event, panelId: string) => {
    addon?.hideTerminal(panelId);
  });

  ipcMain.handle("pier:terminal:close", (_event, panelId: string) => {
    addon?.closeTerminal(panelId);
  });

  ipcMain.on("pier:terminal:focus", (_event, panelId: string) => {
    addon?.focusTerminal(panelId);
  });

  ipcMain.on("pier:terminal:set-overlay", (event, active: boolean) => {
    if (!addon) {
      return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return;
    }
    try {
      addon.setOverlayActive(win.getNativeWindowHandle(), active);
    } catch (err) {
      console.error("[pier-set-overlay] failed:", err);
    }
    // v2: overlay active 时主动调 webContents.focus() 让 Chromium 接管 keystroke.
    // Electron 标准 API, 内部知道正确的 RenderWidgetHostViewCocoa. 替代 v1 swift 端
    // makeFirstResponder(WKWebView) 的脆弱实现 (Electron 42 没真 WKWebView).
    if (active) {
      win.webContents.focus();
    }
  });

  ipcMain.on("pier:terminal:apply-theme", (event, colors: TerminalColors) => {
    if (!addon) {
      return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return;
    }
    try {
      addon.applyTerminalTheme(win.getNativeWindowHandle(), colors);
    } catch (err) {
      console.error("[pier-terminal-apply-theme] failed:", err);
    }
  });

  ipcMain.on(
    "pier:terminal:set-active-panel-kind",
    (event, kind: "terminal" | "web", panelId: string | null) => {
      if (!addon) {
        return;
      }
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) {
        return;
      }
      const kindRaw = kind === "terminal" ? 0 : 1;
      try {
        addon.setActivePanelKind(win.getNativeWindowHandle(), kindRaw, panelId);
      } catch (err) {
        console.error("[pier-set-active-panel-kind] failed:", err);
      }
      // v2: 切到 web panel 时主动调 webContents.focus() (跟 setOverlayActive 同理).
      // swift applyFirstResponder web 分支已 no-op, 由 main 负责 web focus.
      if (kind === "web") {
        win.webContents.focus();
      }
    }
  );
}
