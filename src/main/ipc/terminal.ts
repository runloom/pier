import { createRequire } from "node:module";
import type {
  CreateTerminalArgs,
  TerminalColors,
  TerminalFont,
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
    frame: TerminalFrame,
    fontFamily: string,
    fontSize: number
  ): boolean;
  /** Window 真正销毁时调用一次: closeAll + 卸 EventRouter + 卸 NSEvent monitor */
  detachWindow(parentHandle: Buffer): void;
  focusTerminal(panelId: string): void;
  hideTerminal(panelId: string): void;
  /**
   * 孤儿清理:关掉该 window 下不在 activeIds 集合的 terminal NSView. C 方案
   * reload 零销毁路径上, renderer 重建后报告"我现在还需要这些 panelId",
   * swift 把不在集合里的清掉. 空数组 = 全清 (等价 closeAllTerminals).
   */
  reconcileTerminals(parentHandle: Buffer, activeIds: string[]): void;
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
  setMouseForwardCallback(
    cb:
      | ((
          browserWindowId: number,
          panelId: string,
          x: number,
          y: number
        ) => void)
      | null
  ): void;
  setOverlayActive(parentHandle: Buffer, active: boolean): void;
  /**
   * 注册 PWD forward callback. swift TerminalSurfacePwdDelegate 收到 OSC 7 后调用,
   * 传 (browserWindowId, panelId, cwd). 用 windowId 路由到对应 BrowserWindow 的
   * renderer (多窗口下避免广播污染). 传 null 解绑.
   */
  setPwdForwardCallback(
    cb: ((browserWindowId: number, panelId: string, cwd: string) => void) | null
  ): void;
  /** 热更新 window 下所有 terminal 的字体. controller per window, 内部走 Ghostty TerminalController.setTerminalConfiguration. */
  setTerminalFont(
    parentHandle: Buffer,
    fontFamily: string,
    fontSize: number
  ): void;
  /**
   * 注册 Title forward callback. swift TerminalSurfaceTitleDelegate 收到 OSC 0/2 后调用,
   * 传 (browserWindowId, panelId, title). TUI 应用 (claude / vim / aider) 自定义 title
   * 通道. 与 PWD 路由方式相同, 按 windowId 精准送到对应 BrowserWindow renderer.
   */
  setTitleForwardCallback(
    cb:
      | ((browserWindowId: number, panelId: string, title: string) => void)
      | null
  ): void;
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

/**
 * Forward swift-originated event to a specific BrowserWindow's renderer.
 *
 * 所有 swift→main→renderer forward 共用这一条路由 (keyboard / mouse / pwd / title):
 * 1. 按 browserWindowId 精准定位 BrowserWindow — swift NSEvent monitor / delegate
 *    跨线程, callback 执行时 focused window 可能已切换, 不能用 getFocusedWindow.
 * 2. 守 isDestroyed (window/webContents 在 swift 触发 → main JS dispatch 间可能销毁).
 * 3. send 抛任何错误 (window 关闭瞬间) 都 catch + log + 继续 — 不影响其他 channel.
 */
function forwardToWindow<P>(
  browserWindowId: number,
  channel: string,
  payload: P,
  errorLabel: string
): void {
  try {
    const targetWindow = BrowserWindow.fromId(browserWindowId);
    if (!targetWindow || targetWindow.isDestroyed()) {
      return;
    }
    const wc = targetWindow.webContents;
    if (wc.isDestroyed()) {
      return;
    }
    wc.send(channel, payload);
  } catch (err) {
    console.error(`[${errorLabel}] send failed:`, err);
  }
}

export function registerTerminalIpc(ipcMain: IpcMain): void {
  const { addon, error: loadError } = loadNativeAddon();
  cachedAddon = addon;

  // 四条 swift → renderer forward channel, 全部走 forwardToWindow helper.
  // 不能用 BrowserWindow.getFocusedWindow():swift 触发时 (NSEvent monitor / OSC
  // parser delegate) 跨线程, focused window 不一定是事件源 window — 必须用 setupWindow
  // 时记录的 BrowserWindow.id 精准路由.
  //
  // - keyboard:Cmd+key 全局快捷键 (terminal 透明 + web overlay 架构下唯一可靠通道,
  //   不能依赖 wk.keyDown forward 或 firstResponder chain — Electron 42 ViewsCompositor-
  //   Superview 架构下 WKWebView 不是真正渲染层, Ghostty terminalView focus 时消费所有 key).
  // - mouse:terminal 区域右键 → renderer 调 popupContextMenuAt 弹 native menu.
  // - pwd:OSC 7 → 真实 cwd → descriptor.path / descriptor.short basename.
  // - title:OSC 0/2 → TUI 应用 (claude / vim) 自定义 title → descriptor.long.
  addon?.setKeyboardForwardCallback((id, modifierFlags, chars) => {
    forwardToWindow(
      id,
      "pier:keybinding:forward",
      { modifierFlags, chars },
      "pier-key-forward"
    );
  });
  addon?.setMouseForwardCallback((id, panelId, x, y) => {
    forwardToWindow(
      id,
      "pier:terminal:request-context-menu",
      { panelId, x, y },
      "pier-mouse-forward"
    );
  });
  addon?.setPwdForwardCallback((id, panelId, cwd) => {
    forwardToWindow(
      id,
      "pier:terminal:cwd-change",
      { panelId, cwd },
      "pier-cwd-forward"
    );
  });
  addon?.setTitleForwardCallback((id, panelId, title) => {
    forwardToWindow(
      id,
      "pier:terminal:title-change",
      { panelId, title },
      "pier-title-forward"
    );
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
      const ok = addon.createTerminal(
        handle,
        args.panelId,
        args.frame,
        args.font.family,
        args.font.size
      );
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

  // Renderer → addon 单参数透传 (fire-and-forget): renderer.ipcRenderer.send 单向
  // 触发 addon 同名 method. addon 可能未加载 (非 darwin / native load 失败), 用
  // optional chain 让 callback 仍注册但 noop — 不让 renderer 端 send 静默丢但接收侧
  // "No handler".
  const panelIdRelays = [
    {
      channel: "pier:terminal:show",
      call: (panelId: string) => addon?.showTerminal(panelId),
    },
    {
      channel: "pier:terminal:hide",
      call: (panelId: string) => addon?.hideTerminal(panelId),
    },
    {
      channel: "pier:terminal:focus",
      call: (panelId: string) => addon?.focusTerminal(panelId),
    },
    {
      channel: "pier:terminal:close",
      call: (panelId: string) => addon?.closeTerminal(panelId),
    },
  ] as const;
  for (const { channel, call } of panelIdRelays) {
    ipcMain.on(channel, (_event, panelId: string) => call(panelId));
  }
  // set-frame 多一个 frame 参数, 不进数组单独写.
  ipcMain.on(
    "pier:terminal:set-frame",
    (_event, panelId: string, frame: TerminalFrame) => {
      addon?.setFrame(panelId, frame);
    }
  );

  // Reconcile: renderer 重建后 (dockview restore 完成时) 报告当前活跃 panelId
  // 集合, swift 把不在集合里的 NSView 清掉. C 方案 reload 零销毁路径的孤儿兜底.
  // fire-and-forget: 调用方不需要 await, 失败也只是孤儿 NSView 多挂一会儿,
  // 不影响功能.
  ipcMain.on("pier:terminal:reconcile", (event, activeIds: string[]) => {
    if (!addon) {
      return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return;
    }
    try {
      addon.reconcileTerminals(win.getNativeWindowHandle(), activeIds);
    } catch (err) {
      console.error("[pier-terminal-reconcile] failed:", err);
    }
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
    "pier:terminal:set-font",
    (event, _panelId: string, font: TerminalFont) => {
      // panelId 暂时不用 — Ghostty controller 是 per-window, setTerminalConfiguration
      // 影响该 window 所有 panel. 保留 panelId 在 IPC 签名里, 与 setFrame/show 等保持
      // 一致, 为以后 per-panel 字体留余地.
      if (!addon) {
        return;
      }
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) {
        return;
      }
      try {
        addon.setTerminalFont(
          win.getNativeWindowHandle(),
          font.family,
          font.size
        );
      } catch (err) {
        console.error("[pier-terminal-set-font] failed:", err);
      }
    }
  );

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
