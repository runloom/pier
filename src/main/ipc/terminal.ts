import type { AgentKind } from "@shared/contracts/agent.ts";
import { isPanelTaskLive } from "@shared/contracts/tasks.ts";
import type {
  CreateTerminalArgs,
  TerminalCloseOptions,
  TerminalColors,
  TerminalFont,
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
import { terminalFocusCoordinator } from "./terminal-focus-coordinator.ts";
import { forwardToWindow } from "./terminal-forwarding.ts";
import { isTerminalHostSnapshot } from "./terminal-host-snapshot-validation.ts";
import {
  cancelPromptReady,
  signalPromptReady,
} from "./terminal-initial-input-gate.ts";
import { registerTerminalKeybindingForward } from "./terminal-keybinding-forward.ts";
import { loadNativeAddon, type NativeAddon } from "./terminal-native-addon.ts";
import { handleTerminalOpenUrl } from "./terminal-open-url-forwarding.ts";
import {
  performTerminalOperation,
  readTerminalSelectionText,
} from "./terminal-operations.ts";
import { fromNativePanelKey, toNativePanelKey } from "./terminal-panel-id.ts";
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
  terminalFocusCoordinator.configureNativeAddon(addon);
  const taskOutputBindings =
    addon && deps.taskService
      ? createTaskOutputTerminalBindings({
          addon,
          onSurfaceReset: (browserWindowId, nativePanelId) => {
            const win = findAppWindowByElectronId(browserWindowId);
            if (win) {
              terminalFocusCoordinator.surfaceCreated(
                win,
                fromNativePanelKey(nativePanelId)
              );
            }
          },
          taskService: deps.taskService,
        })
      : null;
  cachedAddon = addon;
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
    const win = findAppWindowByElectronId(id);
    if (!win) {
      return;
    }
    const intent = terminalFocusCoordinator.acceptNativeFocusIntent(
      win,
      panelId
    );
    if (!intent.ok) {
      return;
    }
    forwardToWindow(
      id,
      "pier:terminal:focus-request",
      { panelId: intent.panelId },
      "pier-terminal-focus-request"
    );
  });
  addon?.setOpenUrlForwardCallback((id, panelId, url, kind) => {
    const rawPanelId = fromNativePanelKey(panelId);
    recordNativeTerminalRoute(id, "open-url", panelId, { kind, url });
    handleTerminalOpenUrl({
      broadcast: (event) => {
        forwardToWindow(
          id,
          PIER_BROADCAST.TERMINAL_OPEN_URL,
          event,
          "pier-open-url-forward"
        );
      },
      kind: kind === "html" || kind === "text" ? kind : "unknown",
      openExternal: async (target) => {
        const { shell } = await import("electron");
        await shell.openExternal(target);
      },
      panelId: rawPanelId,
      url,
      windowId: id,
    }).catch((err) => {
      console.error("[pier-open-url] failed:", err);
    });
  });
  addon?.setPwdForwardCallback((id, panelId, cwd) => {
    recordNativeTerminalRoute(id, "cwd", panelId, { cwd });
    const rawPanelId = fromNativePanelKey(panelId);
    // 首次 cwd 事件 = ghostty shell integration 已进入 precmd（准备打
    // prompt），此时把 initialInput 注入 pty 才能落在 shell 已读 stdin
    // 的区间内，避免命令字符被 raw tty echo 打在登录 banner 之前。后续
    // cwd 事件对 gate 是 no-op（gate 一次性消费）。
    signalPromptReady(rawPanelId);
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
      taskService: deps.taskService ?? null,
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
    "pier:terminal:apply-host-snapshot",
    (event, snapshot: unknown) => {
      const win = windowFromWebContents(event.sender);
      if (!win) {
        return;
      }
      if (!isTerminalHostSnapshot(snapshot)) {
        console.error("[pier-terminal-host] invalid snapshot:", snapshot);
        return;
      }
      recordRendererTerminalRoute(win, "apply-host-snapshot", null, {
        basePanel: snapshot.basePanel.kind,
        reason: snapshot.reason,
        rendererSequence: snapshot.rendererSequence,
        terminalCount: snapshot.terminals.length,
        webOverlayRectCount: snapshot.webOverlayRects.length,
        webRequestCount: snapshot.webRequestCount,
      });
      const result = terminalFocusCoordinator.acceptRendererSnapshot(
        win,
        snapshot
      );
      if (result.shouldAck) {
        event.sender.send(PIER_BROADCAST.TERMINAL_PRESENTATION_APPLIED, {
          rendererSequence: snapshot.rendererSequence,
        });
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
      const session = await readTerminalPanelSession(
        windowRecordIdFor(win),
        panelId
      );
      if (!session?.task) {
        return session;
      }
      // main 担保的 task 活性：TaskRuns 仍关联该 panel 的活跃节点 ⇔ renderer
      // reload 重挂路径, 应渲染真终端而非静态结果卡。
      const windowId = findInternalWindowId(win) ?? undefined;
      const taskLive = deps.taskService
        ? isPanelTaskLive(
            deps.taskService.runsSnapshot(windowId),
            panelId,
            windowId
          )
        : false;
      return { ...session, taskLive };
    }
  );

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
        // relaunch = 同 panel 换 pty, 不是面板死亡。TaskRuns 仍持有 panel
        // 映射，RuntimeControl / tab overlay 不依赖 FA task slot。
        taskLifecycle.ignoreNextNativeUserClose(panelId, windowId);
      } else {
        foregroundActivityService.panelClosed(panelId, String(win.id));
        deps.taskService?.markPanelClosed(panelId, windowId);
        taskLifecycle.releasePanel(panelId, windowId);
      }
      const nativePanelId = toNativePanelKey(win, panelId);
      taskOutputBindings?.detach(nativePanelId);
      terminalFocusCoordinator.surfaceWillClose(win, panelId);
      // 面板关闭时清 initial-input gate 的 pending 定时器，防止 pty 已死
      // 但 fallback timer 仍尝试注入到不存在的 panel。
      cancelPromptReady(panelId);
      addon?.closeTerminal(nativePanelId);
      try {
        await removeTerminalPanelSession(sessionScope, panelId);
      } catch (err) {
        console.error("[pier-cwd-remove] failed:", err);
      }
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
