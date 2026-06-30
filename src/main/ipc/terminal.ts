import type {
  CreateTerminalArgs,
  TerminalColors,
  TerminalFont,
  TerminalFrame,
  TerminalPresentationSnapshot,
} from "@shared/contracts/terminal.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import type { IpcMain, WebContents } from "electron";
import {
  readTerminalPanelSession,
  removeTerminalPanelSession,
} from "../state/terminal-session-state.ts";
import type { AppWindow } from "../windows/app-window.ts";
import {
  findAppWindowByElectronId,
  findAppWindowByWebContents,
  findInternalWindowId,
} from "../windows/window-identity.ts";
import {
  consumeCreateLaunch,
  resolveCreateTerminalLaunch,
} from "./terminal-create-launch.ts";
import { handleTerminalCwdChange } from "./terminal-cwd-forwarding.ts";
import {
  recordNativeTerminalRoute,
  recordRendererTerminalRoute,
} from "./terminal-debug.ts";
import { registerTerminalDebugSnapshotIpc } from "./terminal-debug-snapshot.ts";
import {
  focusWebContentsForEffectiveInputRouting,
  setTerminalFocusAddonProvider,
} from "./terminal-focus-state.ts";
import { forwardToWindow } from "./terminal-forwarding.ts";
import {
  persistInitialTerminalContext,
  persistInitialTerminalTask,
} from "./terminal-initial-session.ts";
import { isTerminalInputRoutingSnapshot } from "./terminal-input-routing-validation.ts";
import { registerTerminalKeybindingForward } from "./terminal-keybinding-forward.ts";
import { loadNativeAddon, type NativeAddon } from "./terminal-native-addon.ts";
import { performTerminalOperation } from "./terminal-operations.ts";
import { terminalPanelClosed } from "./terminal-panel-closed.ts";
import { scopePanelId, unscopePanelId } from "./terminal-panel-id.ts";
import {
  applyLatestTerminalPresentation,
  applyRendererTerminalInputRouting,
  applyRendererTerminalPresentation,
  readTerminalInputRoutingDebug,
} from "./terminal-presentation.ts";
import { isTerminalRuntimeConfig } from "./terminal-runtime-config.ts";
import { registerTerminalSearchIpc } from "./terminal-search.ts";
import { registerTerminalShortcutIpc } from "./terminal-shortcuts-ipc.ts";
import { persistInitialTerminalTab } from "./terminal-tab-chrome.ts";
import { registerTerminalTaskLifecycleForwarding } from "./terminal-task-lifecycle-wiring.ts";
import { terminalSessionScopeFor } from "./terminal-window-scope.ts";

let cachedAddon: NativeAddon | null = null;
export const getTerminalAddon = (): NativeAddon | null => cachedAddon;

export function windowFromWebContents(
  webContents: WebContents
): AppWindow | null {
  return findAppWindowByWebContents(webContents);
}

function conformTerminalPresentationAfterCreate(
  win: AppWindow,
  addon: NativeAddon | null
): void {
  applyLatestTerminalPresentation(win, addon, "restore");
  const effectiveInputRouting = readTerminalInputRoutingDebug(win).effective;
  if (effectiveInputRouting) {
    focusWebContentsForEffectiveInputRouting(
      win,
      effectiveInputRouting,
      "terminal-create-conform"
    );
  }
}

export function registerTerminalIpc(ipcMain: IpcMain): void {
  const { addon, error: loadError } = loadNativeAddon();
  cachedAddon = addon;
  setTerminalFocusAddonProvider(() => cachedAddon);
  registerTerminalDebugSnapshotIpc(ipcMain, addon);
  registerTerminalKeybindingForward(addon);
  const taskLifecycle = registerTerminalTaskLifecycleForwarding(addon);
  // Swift 收到 scoped panelId, renderer 使用 raw panel id.
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
    const rawPanelId = unscopePanelId(panelId);
    forwardToWindow(
      id,
      "pier:terminal:focus-request",
      { panelId: rawPanelId },
      "pier-terminal-focus-request"
    );
  });
  addon?.setPwdForwardCallback((id, panelId, cwd) => {
    recordNativeTerminalRoute(id, "cwd", panelId, { cwd });
    const rawPanelId = unscopePanelId(panelId);
    const targetWindow = findAppWindowByElectronId(id);
    handleTerminalCwdChange(id, rawPanelId, cwd, targetWindow).catch((err) => {
      console.error("[pier-cwd-context] failed:", err);
    });
  });
  registerTerminalSearchIpc({
    addon,
    ipcMain,
    loadError,
    windowFromWebContents,
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
      const ok = addon.setupWindow(handle, win.id);
      recordRendererTerminalRoute(win, "setup", null, { ok });
      return ok ? { ok: true } : { ok: false, error: "setupWindow failed" };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle(
    "pier:terminal:perform-operation",
    (event, panelId: unknown, operation: unknown) =>
      performTerminalOperation({
        addon,
        loadError,
        operation,
        panelId,
        win: windowFromWebContents(event.sender),
      })
  );

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
        taskLifecycle.resetPanel(
          args.panelId,
          findInternalWindowId(win) ?? undefined
        );
        const saved = await readTerminalPanelSession(
          sessionScope,
          args.panelId
        );
        const { context, nativeLaunch, task } = resolveCreateTerminalLaunch(
          args,
          saved
        );
        // Task identity is persisted before native launch so immediate command-finished
        // callbacks can be gated to the task panel instead of repainting plain terminals.
        await persistInitialTerminalTask(sessionScope, args.panelId, task);
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
          nativeLaunch
        );
        if (ok) {
          consumeCreateLaunch(args);
          await persistInitialTerminalContext(
            sessionScope,
            args.panelId,
            context
          );
          await persistInitialTerminalTab(sessionScope, args.panelId, args.tab);
          conformTerminalPresentationAfterCreate(win, addon);
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
        reason: snapshot.reason,
        rendererSequence: snapshot.rendererSequence,
        terminalCount: snapshot.terminals.length,
      });
      applyRendererTerminalPresentation(win, addon, snapshot);
      // native applyTerminalPresentation 是同步调用，此刻几何已就位 → 回 ack，
      // 让 renderer 精确握手撤除 resize 占位（替代盲等帧数）。
      event.sender.send(PIER_BROADCAST.TERMINAL_PRESENTATION_APPLIED, {
        rendererSequence: snapshot.rendererSequence,
      });
      const effectiveInputRouting =
        readTerminalInputRoutingDebug(win).effective;
      if (effectiveInputRouting) {
        focusWebContentsForEffectiveInputRouting(
          win,
          effectiveInputRouting,
          "terminal-presentation"
        );
      }
    }
  );

  ipcMain.on(
    "pier:terminal:apply-input-routing",
    (event, snapshot: unknown) => {
      const win = windowFromWebContents(event.sender);
      if (!win) {
        return;
      }
      if (!isTerminalInputRoutingSnapshot(snapshot)) {
        console.error(
          "[pier-terminal-input-routing] invalid snapshot:",
          snapshot
        );
        return;
      }
      recordRendererTerminalRoute(win, "apply-input-routing", null, {
        basePanel: snapshot.basePanel.kind,
        rendererSequence: snapshot.rendererSequence,
        webOverlayRectCount: snapshot.webOverlayRects.length,
        webRequestCount: snapshot.webRequestCount,
      });
      const effective = applyRendererTerminalInputRouting(win, addon, snapshot);
      focusWebContentsForEffectiveInputRouting(
        win,
        effective,
        "terminal-input-routing"
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
      terminalPanelClosed.notifyTerminalPanelClosed(
        panelId,
        findInternalWindowId(win) ?? undefined
      );
      removeTerminalPanelSession(sessionScope, panelId).catch((err) => {
        console.error("[pier-cwd-remove] failed:", err);
      });
      addon?.closeTerminal(scopePanelId(win, panelId));
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

  ipcMain.on("pier:terminal:set-config", (event, config: unknown) => {
    if (!addon) {
      return;
    }
    const win = windowFromWebContents(event.sender);
    if (!win) {
      return;
    }
    if (!isTerminalRuntimeConfig(config)) {
      console.error("[pier-terminal-set-config] invalid config:", config);
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
  });

  registerTerminalShortcutIpc(ipcMain, addon);

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
}
