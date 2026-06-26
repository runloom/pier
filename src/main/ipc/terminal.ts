import { createRequire } from "node:module";
import type {
  CreateTerminalArgs,
  TerminalColors,
  TerminalFont,
  TerminalFrame,
  TerminalRuntimeConfig,
} from "@shared/contracts/terminal.ts";
import type { IpcMain, WebContents } from "electron";
import {
  isToggleDevToolsNativeChord,
  toggleDetachedDevTools,
} from "../devtools.ts";
import {
  archiveTerminalPanelSession,
  readTerminalPanelSession,
  removeTerminalPanelSession,
  updateTerminalPanelCwd,
  updateTerminalPanelTitle,
} from "../state/terminal-session-state.ts";
import type { AppWindow } from "../windows/app-window.ts";
import {
  findAppWindowByElectronId,
  findAppWindowByWebContents,
  findInternalWindowId,
  findWindowSessionId,
} from "../windows/window-identity.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { scopePanelId, unscopePanelId } from "./terminal-panel-id.ts";

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

export function stableWindowIdFor(win: AppWindow): string {
  return findInternalWindowId(win) ?? `window-${win.id}`;
}

export function terminalSessionScopeFor(win: AppWindow): string {
  return findWindowSessionId(win) ?? stableWindowIdFor(win);
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
      cachedAddon?.focusTerminal(scopePanelId(win, active.panelId));
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

export function windowFromWebContents(
  webContents: WebContents
): AppWindow | null {
  return findAppWindowByWebContents(webContents);
}

export function registerTerminalIpc(ipcMain: IpcMain): void {
  const { addon, error: loadError } = loadNativeAddon();
  cachedAddon = addon;

  // swift → renderer forward 必须按 setupWindow 记录的 Electron window id 路由:
  // keyboard / mouse / pwd / title 都不能依赖当前 focused window.
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
  // Swift forward callback 收到的 panelId 是 scoped (createTerminal 时 main 传的),
  // unscope 后给 renderer — React/dockview 的 panel id 是 raw.
  addon?.setMouseForwardCallback((id, panelId, x, y) => {
    forwardToWindow(
      id,
      "pier:terminal:request-context-menu",
      { panelId: unscopePanelId(panelId), x, y },
      "pier-mouse-forward"
    );
  });
  addon?.setTerminalFocusRequestCallback((id, panelId) => {
    forwardToWindow(
      id,
      "pier:terminal:focus-request",
      { panelId: unscopePanelId(panelId) },
      "pier-terminal-focus-request"
    );
  });
  addon?.setPwdForwardCallback((id, panelId, cwd) => {
    const rawPanelId = unscopePanelId(panelId);
    const targetWindow = findAppWindowByElectronId(id);
    if (targetWindow && !targetWindow.isDestroyed()) {
      const sessionScope = terminalSessionScopeFor(targetWindow);
      updateTerminalPanelCwd(sessionScope, rawPanelId, cwd).catch((err) => {
        console.error("[pier-cwd-persist] failed:", err);
      });
    }
    forwardToWindow(
      id,
      "pier:terminal:cwd-change",
      { panelId: rawPanelId, cwd },
      "pier-cwd-forward"
    );
  });
  addon?.setTitleForwardCallback((id, panelId, title) => {
    const rawPanelId = unscopePanelId(panelId);
    const targetWindow = findAppWindowByElectronId(id);
    if (targetWindow && !targetWindow.isDestroyed()) {
      const sessionScope = terminalSessionScopeFor(targetWindow);
      updateTerminalPanelTitle(sessionScope, rawPanelId, title).catch((err) => {
        console.error("[pier-title-persist] failed:", err);
      });
    }
    forwardToWindow(
      id,
      "pier:terminal:title-change",
      { panelId: rawPanelId, title },
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
        const sessionScope = terminalSessionScopeFor(win);
        const saved = await readTerminalPanelSession(
          sessionScope,
          args.panelId
        );
        const cwd = saved?.cwd ?? args.cwd;
        const ok = addon.createTerminal(
          handle,
          scopePanelId(win, args.panelId),
          args.frame,
          args.font.family,
          args.font.size,
          cwd
        );
        if (ok && cwd) {
          try {
            await updateTerminalPanelCwd(sessionScope, args.panelId, cwd);
          } catch (err) {
            console.error("[pier-cwd-initial-persist] failed:", err);
          }
        }
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

  ipcMain.handle(
    "pier:terminal:read-session",
    async (event, panelId: string) => {
      const win = windowFromWebContents(event.sender);
      if (!win) {
        return null;
      }
      return await readTerminalPanelSession(
        terminalSessionScopeFor(win),
        panelId
      );
    }
  );

  // Renderer → addon 单参数透传. addon 可能未加载, handler 仍注册但 noop.
  const panelIdRelays = [
    {
      channel: "pier:terminal:show",
      call: (win: AppWindow, panelId: string) =>
        addon?.showTerminal(scopePanelId(win, panelId)),
    },
    {
      channel: "pier:terminal:hide",
      call: (win: AppWindow, panelId: string) =>
        addon?.hideTerminal(scopePanelId(win, panelId)),
    },
  ] as const;
  for (const { channel, call } of panelIdRelays) {
    ipcMain.on(channel, (event, panelId: string) => {
      const win = windowFromWebContents(event.sender);
      if (!win) {
        return;
      }
      call(win, panelId);
    });
  }
  ipcMain.on("pier:terminal:close", (event, panelId: string) => {
    const win = windowFromWebContents(event.sender);
    if (win) {
      const sessionScope = terminalSessionScopeFor(win);
      archiveTerminalPanelSession(sessionScope, panelId)
        .catch((err) => {
          console.error("[pier-cwd-archive] failed:", err);
        })
        .finally(() => {
          removeTerminalPanelSession(sessionScope, panelId).catch((err) => {
            console.error("[pier-cwd-remove] failed:", err);
          });
        });
      addon?.closeTerminal(scopePanelId(win, panelId));
    }
  });
  ipcMain.on("pier:terminal:focus", (event, panelId: string) => {
    const win = windowFromWebContents(event.sender);
    if (win) {
      rememberActivePanelFocus(win, "terminal", panelId);
      if (!win.isFocused()) {
        blurActivePanelFocus(win);
        return;
      }
      addon?.focusTerminal(scopePanelId(win, panelId));
    }
  });
  // set-frame 多一个 frame 参数, 不进数组单独写.
  ipcMain.on(
    "pier:terminal:set-frame",
    (event, panelId: string, frame: TerminalFrame) => {
      const win = windowFromWebContents(event.sender);
      if (!win) {
        return;
      }
      addon?.setFrame(scopePanelId(win, panelId), frame);
    }
  );

  // Reconcile: renderer restore 完成后报告活跃 terminal, swift 清掉孤儿 NSView.
  ipcMain.on("pier:terminal:reconcile", (event, activeIds: string[]) => {
    if (!addon) {
      return;
    }
    const win = windowFromWebContents(event.sender);
    if (!win) {
      return;
    }
    try {
      addon.reconcileTerminals(
        win.getNativeWindowHandle(),
        activeIds.map((id) => scopePanelId(win, id))
      );
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
    // overlay active 时让 Chromium 接管 keystroke.
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
    "pier:terminal:set-config",
    (event, config: TerminalRuntimeConfig) => {
      if (!addon) {
        return;
      }
      const win = windowFromWebContents(event.sender);
      if (!win) {
        return;
      }
      try {
        addon.setTerminalConfig(win.getNativeWindowHandle(), config);
      } catch (err) {
        console.error("[pier-terminal-set-config] failed:", err);
      }
    }
  );

  ipcMain.on(
    "pier:terminal:set-font",
    (event, _panelId: string, font: TerminalFont) => {
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
        addon.setActivePanelKind(
          win.getNativeWindowHandle(),
          kindRaw,
          panelId ? scopePanelId(win, panelId) : null
        );
      } catch (err) {
        console.error("[pier-set-active-panel-kind] failed:", err);
      }
      // 切到 web panel 时由 main 负责 web focus.
      if (kind === "web" && win.isFocused()) {
        win.webContents.focus();
      }
    }
  );
}
