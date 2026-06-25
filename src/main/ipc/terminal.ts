import { createRequire } from "node:module";
import type {
  CreateTerminalArgs,
  TerminalColors,
  TerminalFont,
  TerminalFrame,
} from "@shared/contracts/terminal.ts";
import type { IpcMain, WebContents } from "electron";
import {
  isToggleDevToolsNativeChord,
  toggleDetachedDevTools,
} from "../devtools.ts";
import {
  readTerminalPanelSession,
  removeTerminalPanelSession,
  updateTerminalPanelCwd,
} from "../state/terminal-session-state.ts";
import type { AppWindow } from "../windows/app-window.ts";
import {
  findAppWindowByElectronId,
  findAppWindowByWebContents,
  findInternalWindowId,
} from "../windows/window-identity.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";

/** 暴露给 window-manager 在 renderer reload/crash 时调用清理. */
export function getTerminalAddon(): NativeAddon | null {
  return cachedAddon;
}

let cachedAddon: NativeAddon | null = null;

interface ActivePanelFocusState {
  kind: "terminal" | "web";
  panelId: string | null;
}

const activePanelFocusByWindowId = new Map<number, ActivePanelFocusState>();

function rememberActivePanelFocus(
  win: AppWindow,
  kind: "terminal" | "web",
  panelId: string | null
): void {
  activePanelFocusByWindowId.set(win.id, { kind, panelId });
}

function stableWindowIdFor(win: AppWindow): string {
  return findInternalWindowId(win) ?? `window-${win.id}`;
}

export function restoreActivePanelFocus(win: AppWindow): void {
  if (win.isDestroyed()) {
    return;
  }
  if (win.isMinimized()) {
    win.restore();
  }
  win.focus();

  const active = activePanelFocusByWindowId.get(win.id);
  if (active?.kind === "terminal" && active.panelId) {
    try {
      cachedAddon?.focusTerminal(active.panelId);
    } catch (err) {
      console.error("[pier-restore-terminal-focus] failed:", err);
    }
    return;
  }

  if (!win.webContents.isDestroyed()) {
    win.webContents.focus();
  }
}

export function blurActivePanelFocus(win: AppWindow): void {
  if (win.isDestroyed()) {
    return;
  }
  try {
    cachedAddon?.setActivePanelKind(win.getNativeWindowHandle(), 1, null);
  } catch (err) {
    console.error("[pier-blur-terminal-focus] failed:", err);
  }
}

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
 * Forward swift-originated event to a specific app window renderer.
 *
 * 所有 swift→main→renderer forward 共用这一条路由 (keyboard / mouse / pwd / title):
 * 1. 按 Electron window id 精准定位 app window — swift NSEvent monitor / delegate
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
    const targetWindow = findAppWindowByElectronId(browserWindowId);
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

function windowFromWebContents(webContents: WebContents): AppWindow | null {
  return findAppWindowByWebContents(webContents);
}

export function registerTerminalIpc(ipcMain: IpcMain): void {
  const { addon, error: loadError } = loadNativeAddon();
  cachedAddon = addon;

  // 四条 swift → renderer forward channel, 全部走 forwardToWindow helper.
  // 不能用 focused window:swift 触发时 (NSEvent monitor / OSC
  // parser delegate) 跨线程, focused window 不一定是事件源 window — 必须用 setupWindow
  // 时记录的 Electron window id 精准路由.
  //
  // - keyboard:Cmd+key 全局快捷键 (terminal 透明 + web overlay 架构下唯一可靠通道,
  //   不能依赖 wk.keyDown forward 或 firstResponder chain — Electron 42 ViewsCompositor-
  //   Superview 架构下 WKWebView 不是真正渲染层, Ghostty terminalView focus 时消费所有 key).
  // - mouse:terminal 区域右键 → renderer 调 popupContextMenuAt 弹 native menu.
  // - pwd:OSC 7 → 真实 cwd → descriptor.path / descriptor.short basename.
  // - title:OSC 0/2 → TUI 应用 (claude / vim) 自定义 title → descriptor.long.
  addon?.setKeyboardForwardCallback((id, modifierFlags, chars) => {
    const targetWindow = findAppWindowByElectronId(id);
    if (
      targetWindow &&
      !targetWindow.isDestroyed() &&
      isToggleDevToolsNativeChord(modifierFlags, chars)
    ) {
      toggleDetachedDevTools(targetWindow);
      return;
    }

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
  addon?.setTerminalFocusRequestCallback((id, panelId) => {
    forwardToWindow(
      id,
      "pier:terminal:focus-request",
      { panelId },
      "pier-terminal-focus-request"
    );
  });
  addon?.setPwdForwardCallback((id, panelId, cwd) => {
    const targetWindow = findAppWindowByElectronId(id);
    if (targetWindow && !targetWindow.isDestroyed()) {
      const windowId = stableWindowIdFor(targetWindow);
      updateTerminalPanelCwd(windowId, panelId, cwd).catch((err) => {
        console.error("[pier-cwd-persist] failed:", err);
      });
    }
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
    const win = windowFromWebContents(event.sender);
    if (!win) {
      return { ok: false, error: "window not found" };
    }
    try {
      const handle = win.getNativeWindowHandle();
      // 把 Electron window id 传给 swift, 让 forward callback 能按 window 路由 (多窗口
      // 下避免 getFocusedWindow 误把 background window 的 keystroke 路由到 focused)
      const ok = addon.setupWindow(handle, win.id);
      return ok ? { ok: true } : { ok: false, error: "setupWindow failed" };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle(
    "pier:terminal:create",
    async (event, args: CreateTerminalArgs) => {
      if (!addon) {
        return { ok: false, error: loadError ?? "native addon not loaded" };
      }
      const win = windowFromWebContents(event.sender);
      if (!win) {
        return { ok: false, error: "window not found" };
      }
      try {
        const handle = win.getNativeWindowHandle();
        const windowId = stableWindowIdFor(win);
        const saved = await readTerminalPanelSession(windowId, args.panelId);
        const cwd = args.cwd ?? saved?.cwd;
        const ok = addon.createTerminal(
          handle,
          args.panelId,
          args.frame,
          args.font.family,
          args.font.size,
          cwd
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
    }
  );

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
  ] as const;
  for (const { channel, call } of panelIdRelays) {
    ipcMain.on(channel, (_event, panelId: string) => call(panelId));
  }
  ipcMain.on("pier:terminal:close", (event, panelId: string) => {
    const win = windowFromWebContents(event.sender);
    if (win) {
      const windowId = stableWindowIdFor(win);
      removeTerminalPanelSession(windowId, panelId).catch((err) => {
        console.error("[pier-cwd-remove] failed:", err);
      });
    }
    addon?.closeTerminal(panelId);
  });
  ipcMain.on("pier:terminal:focus", (event, panelId: string) => {
    const win = windowFromWebContents(event.sender);
    if (win) {
      rememberActivePanelFocus(win, "terminal", panelId);
      if (!win.isFocused()) {
        blurActivePanelFocus(win);
        return;
      }
    }
    addon?.focusTerminal(panelId);
  });
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
    const win = windowFromWebContents(event.sender);
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
    const win = windowFromWebContents(event.sender);
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
    const win = windowFromWebContents(event.sender);
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
      const win = windowFromWebContents(event.sender);
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
      const win = windowFromWebContents(event.sender);
      if (!win) {
        return;
      }
      rememberActivePanelFocus(win, kind, panelId);
      if (!addon) {
        return;
      }
      if (kind === "terminal" && !win.isFocused()) {
        blurActivePanelFocus(win);
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
      if (kind === "web" && win.isFocused()) {
        win.webContents.focus();
      }
    }
  );
}
