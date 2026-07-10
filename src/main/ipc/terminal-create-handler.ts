import type { AgentKind } from "@shared/contracts/agent.ts";
import type {
  CreateTerminalArgs,
  CreateTerminalResult,
} from "@shared/contracts/terminal.ts";
import { resolveAgentResumeLaunch } from "../services/agents/agent-resume-adapters.ts";
import type { ProcessEnvironmentService } from "../services/process-environment-service.ts";
import {
  clearTerminalPanelAgent,
  readTerminalPanelSession,
} from "../state/terminal-session-state.ts";
import type { AppWindow } from "../windows/app-window.ts";
import { findInternalWindowId } from "../windows/window-identity.ts";
import { foregroundActivityService } from "./foreground-activity.ts";
import { resolveRestoredAgentLaunchEnv } from "./terminal-create-env.ts";
import {
  consumeCreateLaunch,
  resolveCreateTerminalLaunch,
  withPanelStatusEnv,
} from "./terminal-create-launch.ts";
import {
  conformTerminalPresentationAfterCreate,
  sendInitialTerminalInput,
} from "./terminal-create-post-actions.ts";
import { recordRendererTerminalRoute } from "./terminal-debug.ts";
import {
  persistInitialTerminalAgent,
  persistInitialTerminalContext,
  persistInitialTerminalTask,
} from "./terminal-initial-session.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { toNativePanelKey } from "./terminal-panel-id.ts";
import { persistInitialTerminalTab } from "./terminal-tab-chrome.ts";
import type { RegisteredTerminalTaskLifecycle } from "./terminal-task-lifecycle-wiring.ts";
import { windowRecordIdFor } from "./terminal-window-scope.ts";

export async function handleTerminalCreate(args: {
  addon: NativeAddon | null;
  createArgs: CreateTerminalArgs;
  loadError: string | null;
  processEnvironment: ProcessEnvironmentService;
  recordAgentLaunch?:
    | ((agentId: AgentKind) => Promise<unknown> | unknown)
    | undefined;
  taskLifecycle: RegisteredTerminalTaskLifecycle;
  win: AppWindow | null;
}): Promise<CreateTerminalResult> {
  const {
    addon,
    createArgs,
    loadError,
    processEnvironment,
    recordAgentLaunch,
    taskLifecycle,
    win,
  } = args;
  if (!addon) {
    foregroundActivityService.panelClosed(createArgs.panelId);
    return { ok: false, error: loadError ?? "native addon not loaded" };
  }
  if (!win) {
    return { ok: false, error: "window not found" };
  }
  const sessionScope = windowRecordIdFor(win);
  try {
    const handle = win.getNativeWindowHandle();
    taskLifecycle.resetPanel(
      createArgs.panelId,
      findInternalWindowId(win) ?? undefined
    );
    const saved = await readTerminalPanelSession(
      sessionScope,
      createArgs.panelId
    );
    const taskLive = foregroundActivityService
      .snapshot(String(win.id))
      .activities.some(
        (activity) =>
          activity.kind === "task" && activity.panelId === createArgs.panelId
      );
    const launch = resolveCreateTerminalLaunch(createArgs, saved, { taskLive });
    await persistInitialTerminalTask(
      sessionScope,
      createArgs.panelId,
      launch.task
    );
    recordRendererTerminalRoute(win, "create", createArgs.panelId, {
      height: createArgs.frame.height,
      width: createArgs.frame.width,
      x: createArgs.frame.x,
      y: createArgs.frame.y,
    });
    const resumeLaunch = launch.restoredAgent
      ? resolveAgentResumeLaunch({
          agent: launch.restoredAgent,
          cwd: launch.context?.cwd ?? launch.nativeLaunch?.cwd,
        })
      : null;
    const nativeLaunchBase = resumeLaunch?.launch ?? launch.nativeLaunch;
    const launchForNative = launch.restoredAgentLaunch
      ? await resolveRestoredAgentLaunchEnv(
          nativeLaunchBase,
          processEnvironment
        )
      : nativeLaunchBase;
    await persistInitialTerminalAgent(
      sessionScope,
      createArgs.panelId,
      launch.launchAgentId,
      launch.restoredAgent?.launch ?? launchForNative,
      { resume: launch.restoredAgent?.resume }
    );
    const nativePanelId = toNativePanelKey(win, createArgs.panelId);
    const ok = addon.createTerminal(
      handle,
      nativePanelId,
      createArgs.frame,
      createArgs.font.family,
      createArgs.font.size,
      withPanelStatusEnv(
        launchForNative,
        createArgs.panelId,
        String(win.id),
        foregroundActivityService.hookEnv()
      )
    );
    if (!ok) {
      foregroundActivityService.panelClosed(createArgs.panelId);
      await clearTerminalPanelAgent(sessionScope, createArgs.panelId);
      return { ok: false, error: "createTerminal returned false" };
    }
    sendInitialTerminalInput({
      addon,
      initialInput: createArgs.initialInput,
      nativePanelId,
      panelId: createArgs.panelId,
    });
    if (launch.launchAgentId) {
      foregroundActivityService.agentLaunched(
        String(win.id),
        createArgs.panelId,
        launch.launchAgentId
      );
      if (!launch.restoredAgentLaunch && recordAgentLaunch) {
        try {
          await recordAgentLaunch(launch.launchAgentId);
        } catch (err) {
          // 使用偏好是非关键记录，不得让已成功创建的终端反向失败。
          console.warn("[agent-usage] record launch failed:", err);
        }
      }
    }
    consumeCreateLaunch(createArgs);
    await persistInitialTerminalContext(
      sessionScope,
      createArgs.panelId,
      launch.context
    );
    await persistInitialTerminalTab(
      sessionScope,
      createArgs.panelId,
      createArgs.tab
    );
    conformTerminalPresentationAfterCreate(win, addon);
    return { ok: true };
  } catch (err) {
    foregroundActivityService.panelClosed(createArgs.panelId);
    await clearTerminalPanelAgent(sessionScope, createArgs.panelId);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
