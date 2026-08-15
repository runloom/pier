import type { AgentKind } from "@shared/contracts/agent.ts";
import { isPanelTaskLive } from "@shared/contracts/tasks.ts";
import type {
  CreateTerminalArgs,
  TerminalColors,
  TerminalFont,
} from "@shared/contracts/terminal.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import type { IpcMain } from "electron";
import type { ProcessEnvironmentService } from "../../services/process-environment-service.ts";
import { createProcessEnvironmentService } from "../../services/process-environment-service.ts";
import type { ManagedAgentLaunchGate } from "../../services/project-skills/launch-gate/index.ts";
import type { TaskService } from "../../services/tasks/service.ts";
import { readTerminalPanelSession } from "../../state/terminal-session-state.ts";
import {
  findAppWindowByElectronId,
  findAppWindowByInternalId,
  findInternalWindowId,
} from "../../windows/identity.ts";
import { wireTerminalAgentEscapeCancel } from "./agent-escape-cancel.ts";
import { handleTerminalCreate } from "./create-handler.ts";
import { handleTerminalCwdChange } from "./cwd-forwarding.ts";
import {
  recordNativeTerminalRoute,
  recordRendererTerminalRoute,
} from "./debug.ts";
import { registerTerminalDiagnosticsIpc } from "./diagnostics-ipc.ts";
import { terminalFocusCoordinator } from "./focus-coordinator.ts";
import { forwardToWindow } from "./forwarding.ts";
import { registerTerminalHostCopyIpc } from "./host-copy-ipc.ts";
import { isTerminalHostSnapshot } from "./host-snapshot-validation.ts";
import { signalPromptReady } from "./initial-input-gate.ts";
import { registerTerminalInputIpc } from "./input-ipc.ts";
import { registerTerminalKeybindingForward } from "./keybinding-forward.ts";
import { loadNativeAddon } from "./native-addon.ts";
import { handleTerminalOpenUrl } from "./open-url-forwarding.ts";
import { fromNativePanelKey, toNativePanelKey } from "./panel-id.ts";
import { isTerminalRuntimeConfig } from "./runtime-config.ts";
import { registerTerminalSearchIpc } from "./search.ts";
import { registerTerminalShortcutIpc } from "./shortcuts-ipc.ts";
import { registerTerminalTaskLifecycleForwarding } from "./task-lifecycle-wiring.ts";
import { createTaskOutputTerminalBindings } from "./task-output-bindings.ts";
import { registerTerminalTaskOutputRebindIpc } from "./task-output-rebind.ts";
import {
  bindTerminalTransferRuntime,
  registerTerminalTransferGuardIpc,
} from "./transfer-guards.ts";
import { windowFromWebContents, windowRecordIdFor } from "./window-scope.ts";

export {
  getTerminalAddon,
  getTerminalTaskLifecycleForTransfer,
  getTerminalTaskOutputBindingsForTransfer,
  getTerminalTaskServiceForTransfer,
} from "./transfer-guards.ts";
export { windowFromWebContents } from "./window-scope.ts";

export function registerTerminalIpc(
  ipcMain: IpcMain,
  deps: {
    launchGate?: ManagedAgentLaunchGate | null | undefined;
    loadNativeAddon?: () => ReturnType<typeof loadNativeAddon>;
    localEnvironments?:
      | import("../../services/local-environments-service.ts").LocalEnvironmentService
      | undefined;
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
  registerTerminalDiagnosticsIpc(ipcMain, addon);
  registerTerminalKeybindingForward(addon);
  wireTerminalAgentEscapeCancel(addon);
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
    shouldRetainSurfaceOnProcessExit: (panelId, windowId, sessionWindowId) =>
      deps.taskService?.shouldRetainSurfaceOnProcessExit(
        panelId,
        windowId,
        sessionWindowId
      ) ?? false,
  });
  bindTerminalTransferRuntime({
    addon,
    taskLifecycle,
    taskOutputBindings,
    taskService: deps.taskService ?? null,
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
  addon?.setFrameCommittedCallback?.(
    (
      id,
      panelId,
      presentationId,
      surfaceGeneration,
      requestSequence,
      drawSequence,
      pixelWidth,
      pixelHeight
    ) => {
      forwardToWindow(
        id,
        PIER_BROADCAST.TERMINAL_FRAME_COMMITTED,
        {
          drawSequence,
          panelId: fromNativePanelKey(panelId),
          pixelHeight,
          pixelWidth,
          presentationId,
          requestSequence,
          surfaceGeneration,
        },
        "pier-terminal-frame-committed"
      );
    }
  );
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
    // 首次 cwd = precmd。gate 在有 viewport 时等到 prompt 画完再注入。
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

  registerTerminalInputIpc({
    addon,
    ipcMain,
    loadError,
    windowFromWebContents,
  });

  ipcMain.handle("pier:terminal:create", (event, args: CreateTerminalArgs) =>
    handleTerminalCreate({
      addon,
      createArgs: args,
      loadError,
      launchGate: deps.launchGate ?? null,
      localEnvironments: deps.localEnvironments ?? null,
      processEnvironment,
      recordAgentLaunch: deps.recordAgentLaunch,
      taskLifecycle,
      taskOutputBindings,
      taskService: deps.taskService ?? null,
      win: windowFromWebContents(event.sender),
    })
  );

  registerTerminalHostCopyIpc({
    addon,
    ipcMain,
    windowFromWebContents,
  });

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
    "pier:terminal:set-session-title",
    async (
      event,
      panelId: string,
      input: { title: string; source: "user" }
    ) => {
      const win = windowFromWebContents(event.sender);
      if (!win || typeof panelId !== "string" || panelId.trim().length === 0) {
        return { applied: false, ok: false };
      }
      if (
        !input ||
        typeof input.title !== "string" ||
        input.source !== "user"
      ) {
        return { applied: false, ok: false };
      }
      const { setTerminalPanelSessionTitle } = await import(
        "../../state/terminal-session-title.ts"
      );
      const { foregroundActivityService } = await import(
        "../foreground-activity.ts"
      );
      // FA 槽位键 = Electron id；session JSON 键 = record UUID。
      const faWindowId = String(win.id);
      const sessionScope = windowRecordIdFor(win);
      const activity = foregroundActivityService
        .snapshot(faWindowId)
        .activities.find(
          (candidate) =>
            candidate.kind === "agent" && candidate.panelId === panelId
        );
      const sessionId =
        activity?.kind === "agent" ? activity.sessionId?.trim() : undefined;
      const persisted = await setTerminalPanelSessionTitle(
        sessionScope,
        panelId,
        {
          source: input.source,
          ...(sessionId ? { sessionId } : {}),
          title: input.title,
        }
      );
      if (!persisted.ok) {
        return { applied: false, ok: false };
      }
      if (persisted.applied && persisted.title) {
        foregroundActivityService.setAgentSessionTitle(faWindowId, panelId, {
          source: persisted.source ?? input.source,
          ...(persisted.sessionId ? { sessionId: persisted.sessionId } : {}),
          title: persisted.title,
        });
      } else if (persisted.title && persisted.source) {
        foregroundActivityService.hydrateAgentSessionTitle(
          faWindowId,
          panelId,
          {
            source: persisted.source,
            ...(persisted.sessionId ? { sessionId: persisted.sessionId } : {}),
            title: persisted.title,
          }
        );
      }
      return { applied: Boolean(persisted.applied), ok: true };
    }
  );

  registerTerminalTransferGuardIpc({
    addon,
    ipcMain,
    taskLifecycle,
    taskOutputBindings,
    taskService: deps.taskService,
    windowFromWebContents,
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
