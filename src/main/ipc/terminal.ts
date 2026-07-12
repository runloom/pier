import type { AgentKind } from "@shared/contracts/agent.ts";
import type {
  CreateTerminalArgs,
  TerminalCloseOptions,
  TerminalColors,
  TerminalFont,
  TerminalFrame,
  TerminalPresentationSnapshot,
  TerminalSelectionTextResult,
} from "@shared/contracts/terminal.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import type { IpcMain, WebContents } from "electron";
import type { ProcessEnvironmentService } from "../services/process-environment-service.ts";
import { createProcessEnvironmentService } from "../services/process-environment-service.ts";
import type { TaskService } from "../services/tasks/task-service.ts";
import {
  readTerminalPanelSession,
  removeTerminalPanelSession,
} from "../state/terminal-session-state.ts";
import type { AppWindow } from "../windows/app-window.ts";
import {
  findAppWindowByElectronId,
  findAppWindowByInternalId,
  findAppWindowByWebContents,
  findInternalWindowId,
} from "../windows/window-identity.ts";
import { foregroundActivityService } from "./foreground-activity.ts";
import { handleTerminalCreate } from "./terminal-create-handler.ts";
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
import { isTerminalInputRoutingSnapshot } from "./terminal-input-routing-validation.ts";
import { registerTerminalKeybindingForward } from "./terminal-keybinding-forward.ts";
import { loadNativeAddon, type NativeAddon } from "./terminal-native-addon.ts";
import {
  performTerminalOperation,
  readTerminalSelectionText,
} from "./terminal-operations.ts";
import { fromNativePanelKey, toNativePanelKey } from "./terminal-panel-id.ts";
import {
  applyRendererTerminalInputRouting,
  applyRendererTerminalPresentation,
  readTerminalInputRoutingDebug,
} from "./terminal-presentation.ts";
import { isTerminalRuntimeConfig } from "./terminal-runtime-config.ts";
import { registerTerminalSearchIpc } from "./terminal-search.ts";
import { registerTerminalShortcutIpc } from "./terminal-shortcuts-ipc.ts";
import { registerTerminalTaskLifecycleForwarding } from "./terminal-task-lifecycle-wiring.ts";
import { createTaskOutputTerminalBindings } from "./terminal-task-output-bindings.ts";
import { registerTerminalTaskOutputRebindIpc } from "./terminal-task-output-rebind.ts";
import { windowRecordIdFor } from "./terminal-window-scope.ts";

let cachedAddon: NativeAddon | null = null;
export const getTerminalAddon = (): NativeAddon | null => cachedAddon;

export function windowFromWebContents(
  webContents: WebContents
): AppWindow | null {
  return findAppWindowByWebContents(webContents);
}

export function registerTerminalIpc(
  ipcMain: IpcMain,
  deps: {
    loadNativeAddon?: () => ReturnType<typeof loadNativeAddon>;
    processEnvironment?: ProcessEnvironmentService | undefined;
    recordAgentLaunch?:
      | ((agentId: AgentKind) => Promise<unknown> | unknown)
      | undefined;
    taskService?: TaskService | undefined;
  } = {}
): void {
  const processEnvironment =
    deps.processEnvironment ?? createProcessEnvironmentService();
  const loadAddon = deps.loadNativeAddon ?? loadNativeAddon;
  const { addon, error: loadError } = loadAddon();
  const taskOutputBindings =
    addon && deps.taskService
      ? createTaskOutputTerminalBindings({
          addon,
          taskService: deps.taskService,
        })
      : null;
  cachedAddon = addon;
  setTerminalFocusAddonProvider(() => cachedAddon);
  registerTerminalDebugSnapshotIpc(ipcMain, addon);
  registerTerminalKeybindingForward(addon);
  deps.taskService?.bindTerminalProcessController({
    forceStop: (panelId, windowId) => {
      const win = windowId ? findAppWindowByInternalId(windowId) : null;
      if (!(addon && win && !win.isDestroyed())) {
        return { message: "terminal process is unavailable", ok: false };
      }
      return addon.closeTerminal(toNativePanelKey(win, panelId))
        ? { ok: true }
        : { message: "terminal process was not found", ok: false };
    },
    interrupt: (panelId, windowId) => {
      const win = windowId ? findAppWindowByInternalId(windowId) : null;
      if (!(addon && win && !win.isDestroyed())) {
        return { message: "terminal process is unavailable", ok: false };
      }
      const ok = addon.sendText(toNativePanelKey(win, panelId), "\u0003");
      return ok
        ? { ok: true }
        : { message: "terminal rejected the interrupt", ok: false };
    },
  });
  const taskLifecycle = registerTerminalTaskLifecycleForwarding(addon, {
    completeTaskPanel: (panelId, exitCode, lifecycleId, windowId) =>
      deps.taskService?.completePanel(
        panelId,
        exitCode,
        windowId,
        lifecycleId || undefined
      ) ?? Promise.resolve(null),
    isTaskStopRequested: (panelId, windowId) =>
      deps.taskService?.isStopRequested(panelId, windowId) ?? false,
    markTaskPanelClosed: (panelId, windowId) =>
      deps.taskService?.markPanelClosed(panelId, windowId),
  });
  // Swift 收到 scoped panelId, renderer 使用 raw panel id.
  addon?.setMouseForwardCallback((id, panelId, x, y) => {
    recordNativeTerminalRoute(id, "right-mouse", panelId, { x, y });
    forwardToWindow(
      id,
      "pier:terminal:request-context-menu",
      { panelId: fromNativePanelKey(panelId), x, y },
      "pier-mouse-forward"
    );
  });
  addon?.setTerminalFocusRequestCallback((id, panelId) => {
    recordNativeTerminalRoute(id, "focus-request", panelId);
    const rawPanelId = fromNativePanelKey(panelId);
    forwardToWindow(
      id,
      "pier:terminal:focus-request",
      { panelId: rawPanelId },
      "pier-terminal-focus-request"
    );
  });
  addon?.setPwdForwardCallback((id, panelId, cwd) => {
    recordNativeTerminalRoute(id, "cwd", panelId, { cwd });
    const rawPanelId = fromNativePanelKey(panelId);
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
    "pier:terminal:read-selection-text",
    (event, panelId: unknown) =>
      Promise.resolve().then(() => {
        const trimmedPanelId =
          typeof panelId === "string" ? panelId.trim() : "";
        if (!trimmedPanelId) {
          return { kind: "empty" } satisfies TerminalSelectionTextResult;
        }
        const win = windowFromWebContents(event.sender);
        if (!win) {
          return {
            kind: "error",
            message: "Terminal window is not available.",
          } satisfies TerminalSelectionTextResult;
        }
        try {
          const text = readTerminalSelectionText({
            addon,
            loadError,
            panelId: trimmedPanelId,
            win,
          });
          if (!text) {
            return { kind: "empty" } satisfies TerminalSelectionTextResult;
          }
          return { kind: "ok", text } satisfies TerminalSelectionTextResult;
        } catch (err) {
          return {
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          } satisfies TerminalSelectionTextResult;
        }
      })
  );

  ipcMain.handle("pier:terminal:create", (event, args: CreateTerminalArgs) =>
    handleTerminalCreate({
      addon,
      createArgs: args,
      loadError,
      processEnvironment,
      recordAgentLaunch: deps.recordAgentLaunch,
      taskLifecycle,
      taskOutputBindings,
      win: windowFromWebContents(event.sender),
    })
  );

  registerTerminalTaskOutputRebindIpc({
    addon,
    ipcMain,
    taskOutputBindings,
    windowFromSender: windowFromWebContents,
  });

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
      const session = await readTerminalPanelSession(
        windowRecordIdFor(win),
        panelId
      );
      if (!session?.task) {
        return session;
      }
      // main 担保的 task 活性：foreground-activity 有 task slot（终态常驻,
      // 与 panel 同寿命）⇔ 该 task 面板寿命仍在本 main 进程内 ⇔ renderer
      // 属 reload 重挂路径, 应渲染真终端而非静态结果卡。
      const taskLive = foregroundActivityService
        .snapshot(String(win.id))
        .activities.some((a) => a.kind === "task" && a.panelId === panelId);
      return { ...session, taskLive };
    }
  );

  const panelIdRelays = [
    {
      channel: "pier:terminal:show",
      call: (win: AppWindow, panelId: string) =>
        addon?.showTerminal(toNativePanelKey(win, panelId)),
    },
    {
      channel: "pier:terminal:hide",
      call: (win: AppWindow, panelId: string) =>
        addon?.hideTerminal(toNativePanelKey(win, panelId)),
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
  ipcMain.handle(
    "pier:terminal:close",
    async (
      event,
      panelId: string,
      options?: TerminalCloseOptions | undefined
    ) => {
      const win = windowFromWebContents(event.sender);
      if (!win) {
        return;
      }
      const windowId = findInternalWindowId(win) ?? undefined;
      const sessionScope = windowRecordIdFor(win);
      recordRendererTerminalRoute(win, "close", panelId);
      if (options?.reason === "relaunch") {
        // relaunch = 同 panel 换 pty, 不是面板死亡——activity slot 不清。
        // rerun 时序：renderer 先关闭旧 PTY，再创建并确认新 PTY，最后才 resolve
        // terminal.open。这个间隙必须保留 task activity slot；否则新 PTY 确认前
        // 浮层和 tab 会短暂丢失，后续 taskFinished 也可能因 kind 守卫落空。
        // 旧 PTY 的收尾由 native process-closed → ptyExited 按层语义处理。
        taskLifecycle.ignoreNextNativeUserClose(panelId, windowId);
      } else {
        foregroundActivityService.panelClosed(panelId, String(win.id));
        deps.taskService?.markPanelClosed(panelId, windowId);
        taskLifecycle.releasePanel(panelId, windowId);
      }
      const nativePanelId = toNativePanelKey(win, panelId);
      taskOutputBindings?.detach(nativePanelId);
      addon?.closeTerminal(nativePanelId);
      try {
        await removeTerminalPanelSession(sessionScope, panelId);
      } catch (err) {
        console.error("[pier-cwd-remove] failed:", err);
      }
    }
  );
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
      addon?.setFrame(toNativePanelKey(win, panelId), frame);
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
    foregroundActivityService.retainPanels(String(win.id), activeIds);
    try {
      const activeNativeIds = activeIds.map((id) => toNativePanelKey(win, id));
      taskOutputBindings?.retainWindow(win.id, activeNativeIds);
      addon.reconcileTerminals(win.getNativeWindowHandle(), activeNativeIds);
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
