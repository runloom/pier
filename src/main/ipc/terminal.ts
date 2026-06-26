import type {
  CreateTerminalArgs,
  TerminalColors,
  TerminalFont,
  TerminalFrame,
  TerminalPresentationSnapshot,
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
} from "../windows/window-identity.ts";
import {
  recordNativeTerminalRoute,
  recordRendererTerminalRoute,
  recordWebContentsRoute,
} from "./terminal-debug.ts";
import { registerTerminalDebugSnapshotIpc } from "./terminal-debug-snapshot.ts";
import {
  blurActivePanelFocus,
  focusWebContentsForEffectivePresentation,
  rememberActivePanelFocus,
  setTerminalFocusAddonProvider,
} from "./terminal-focus-state.ts";
import { forwardToWindow } from "./terminal-forwarding.ts";
import { loadNativeAddon, type NativeAddon } from "./terminal-native-addon.ts";
import { scopePanelId, unscopePanelId } from "./terminal-panel-id.ts";
import {
  applyLatestTerminalPresentation,
  applyRendererTerminalPresentation,
  setTerminalOverlayActive,
} from "./terminal-presentation.ts";
import { terminalSessionScopeFor } from "./terminal-window-scope.ts";

/** 暴露给 window-manager 在 renderer reload/crash 时调用清理. */
export function getTerminalAddon(): NativeAddon | null {
  return cachedAddon;
}

let cachedAddon: NativeAddon | null = null;

export function windowFromWebContents(
  webContents: WebContents
): AppWindow | null {
  return findAppWindowByWebContents(webContents);
}

async function persistInitialTerminalCwd(
  sessionScope: string,
  panelId: string,
  cwd: string | undefined
): Promise<void> {
  if (!cwd) {
    return;
  }
  try {
    await updateTerminalPanelCwd(sessionScope, panelId, cwd);
  } catch (err) {
    console.error("[pier-cwd-initial-persist] failed:", err);
  }
}

export function registerTerminalIpc(ipcMain: IpcMain): void {
  const { addon, error: loadError } = loadNativeAddon();
  cachedAddon = addon;
  setTerminalFocusAddonProvider(() => cachedAddon);
  registerTerminalDebugSnapshotIpc(ipcMain, addon);

  // swift → renderer forward 必须按 setupWindow 记录的 Electron window id 路由:
  // keyboard / mouse / pwd / title 都不能依赖当前 focused window.
  addon?.setKeyboardForwardCallback((id, modifierFlags, chars) => {
    recordNativeTerminalRoute(id, "key-forward", null, {
      chars,
      modifierFlags,
    });
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
    recordNativeTerminalRoute(id, "right-mouse", panelId, { x, y });
    forwardToWindow(
      id,
      "pier:terminal:request-context-menu",
      { panelId: unscopePanelId(panelId), x, y },
      "pier-mouse-forward"
    );
  });
  addon?.setTerminalFocusRequestCallback((id, panelId) => {
    recordNativeTerminalRoute(id, "focus-request", panelId);
    forwardToWindow(
      id,
      "pier:terminal:focus-request",
      { panelId: unscopePanelId(panelId) },
      "pier-terminal-focus-request"
    );
  });
  addon?.setPwdForwardCallback((id, panelId, cwd) => {
    recordNativeTerminalRoute(id, "cwd", panelId, { cwd });
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
    recordNativeTerminalRoute(id, "title", panelId, { title });
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
      recordRendererTerminalRoute(win, "setup", null, { ok });
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
        recordRendererTerminalRoute(win, "create", args.panelId, {
          height: args.frame.height,
          width: args.frame.width,
          x: args.frame.x,
          y: args.frame.y,
        });
        const ok = addon.createTerminal(
          handle,
          scopePanelId(win, args.panelId),
          args.frame,
          args.font.family,
          args.font.size,
          cwd
        );
        await persistInitialTerminalCwd(
          sessionScope,
          args.panelId,
          ok ? cwd : undefined
        );
        if (ok) {
          const effective = applyLatestTerminalPresentation(
            win,
            addon,
            "restore"
          );
          focusWebContentsForEffectivePresentation(
            win,
            effective,
            "terminal-create-conform"
          );
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

  ipcMain.on(
    "pier:terminal:apply-presentation",
    (event, snapshot: TerminalPresentationSnapshot) => {
      const win = windowFromWebContents(event.sender);
      if (!win) {
        return;
      }
      recordRendererTerminalRoute(win, "apply-presentation", null, {
        hasMaximizedGroup: snapshot.hasMaximizedGroup,
        overlayActive: snapshot.overlayActive,
        reason: snapshot.reason,
        rendererSequence: snapshot.rendererSequence,
        terminalCount: snapshot.terminals.length,
      });
      const effective = applyRendererTerminalPresentation(win, addon, snapshot);
      focusWebContentsForEffectivePresentation(
        win,
        effective,
        "terminal-presentation"
      );
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
      recordRendererTerminalRoute(
        win,
        channel === "pier:terminal:show" ? "show" : "hide",
        panelId
      );
      call(win, panelId);
    });
  }
  ipcMain.on("pier:terminal:close", (event, panelId: string) => {
    const win = windowFromWebContents(event.sender);
    if (win) {
      const sessionScope = terminalSessionScopeFor(win);
      recordRendererTerminalRoute(win, "close", panelId);
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
      recordRendererTerminalRoute(win, "focus", panelId, {
        windowFocused: win.isFocused(),
      });
      if (!win.isFocused()) {
        blurActivePanelFocus(win);
        return;
      }
      addon?.focusTerminal(scopePanelId(win, panelId));
    }
  });
  ipcMain.on(
    "pier:terminal:set-frame",
    (event, panelId: string, frame: TerminalFrame) => {
      const win = windowFromWebContents(event.sender);
      if (!win) {
        return;
      }
      recordRendererTerminalRoute(win, "set-frame", panelId, {
        height: frame.height,
        width: frame.width,
        x: frame.x,
        y: frame.y,
      });
      addon?.setFrame(scopePanelId(win, panelId), frame);
    }
  );

  ipcMain.on("pier:terminal:reconcile", (event, activeIds: string[]) => {
    if (!addon) {
      return;
    }
    const win = windowFromWebContents(event.sender);
    if (!win) {
      return;
    }
    recordRendererTerminalRoute(win, "reconcile", null, {
      count: activeIds.length,
    });
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
    const win = windowFromWebContents(event.sender);
    if (!win) {
      return;
    }
    recordRendererTerminalRoute(win, "set-overlay", null, { active });
    try {
      const effective = setTerminalOverlayActive(win, addon, active);
      focusWebContentsForEffectivePresentation(
        win,
        effective,
        "terminal-overlay"
      );
    } catch (err) {
      console.error("[pier-set-overlay] failed:", err);
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
    recordRendererTerminalRoute(win, "apply-theme", null);
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
      recordRendererTerminalRoute(win, "set-config", null, {
        cursorBlink: config.cursorBlink,
        pasteProtection: config.pasteProtection,
      });
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
      recordRendererTerminalRoute(win, "set-font", _panelId, {
        fontSize: font.size,
      });
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
      recordRendererTerminalRoute(win, "set-active-panel-kind", panelId, {
        kind,
      });
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
      if (kind === "web" && win.isFocused()) {
        recordWebContentsRoute(win, "focus-webcontents", {
          reason: "active-web-panel",
        });
        win.webContents.focus();
      }
    }
  );
}
