import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  isPanelTaskLive,
  taskOutputPanelParamsSchema,
} from "@shared/contracts/tasks.ts";
import type {
  CreateTerminalArgs,
  CreateTerminalResult,
  TerminalAgentRestoreOutcome,
} from "@shared/contracts/terminal.ts";
import {
  resolveAgentResumeLastLaunch,
  resolveAgentResumeLaunch,
} from "../../services/agents/resume-adapters.ts";
import type { LocalEnvironmentService } from "../../services/local-environments-service.ts";
import { getTerminalPanelTransfer } from "../../services/panel-transfer/terminal.ts";
import { createTerminalAndSeedResource } from "../../services/pier-resource/claim-login-after-create.ts";
import { resolveProjectEnvForSpawn } from "../../services/process-environment/resolve-project-env.ts";
import type { ProcessEnvironmentService } from "../../services/process-environment-service.ts";
import type { ManagedAgentLaunchGate } from "../../services/project-skills/launch-gate/index.ts";
import type { TaskService } from "../../services/tasks/service-types.ts";
import {
  clearTerminalPanelAgent,
  ensureTerminalPanelSession,
  readTerminalPanelSession,
} from "../../state/terminal-session-state.ts";
import type { AppWindow } from "../../windows/app-window.ts";
import { findInternalWindowId } from "../../windows/identity.ts";
import { foregroundActivityService } from "../foreground-activity.ts";
import { resolveRestoredAgentLaunchEnv } from "./create-env.ts";
import {
  consumeCreateLaunch,
  resolveCreateTerminalLaunch,
  withAgentLoginShellSafeCommand,
  withPanelStatusEnv,
} from "./create-launch.ts";
import { sendInitialTerminalInput } from "./create-post-actions.ts";
import { resolveTerminalTransferCreateAction } from "./create-transfer-guard.ts";
import { recordRendererTerminalRoute } from "./debug.ts";
import { terminalFocusCoordinator } from "./focus-coordinator.ts";
import {
  persistInitialTerminalAgent,
  persistInitialTerminalContext,
  persistInitialTerminalTask,
} from "./initial-session.ts";
import type { NativeAddon } from "./native-addon.ts";
import { toNativePanelKey } from "./panel-id.ts";
import { persistInitialTerminalTab } from "./tab-chrome.ts";
import type { RegisteredTerminalTaskLifecycle } from "./task-lifecycle-wiring.ts";
import type { TaskOutputTerminalBindings } from "./task-output-bindings.ts";
import { windowRecordIdFor } from "./window-scope.ts";

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

export async function handleTerminalCreate(args: {
  addon: NativeAddon | null;
  createArgs: CreateTerminalArgs;
  loadError: string | null;
  launchGate?: ManagedAgentLaunchGate | null | undefined;
  localEnvironments?:
    | Pick<LocalEnvironmentService, "resolveForWorktree" | "resolveProject">
    | null
    | undefined;
  processEnvironment: ProcessEnvironmentService;
  recordAgentLaunch?:
    | ((agentId: AgentKind) => Promise<unknown> | unknown)
    | undefined;
  taskLifecycle: RegisteredTerminalTaskLifecycle;
  taskOutputBindings: TaskOutputTerminalBindings | null;
  taskService: TaskService | null;
  win: AppWindow | null;
}): Promise<CreateTerminalResult> {
  const {
    addon,
    createArgs,
    loadError,
    launchGate,
    localEnvironments,
    processEnvironment,
    recordAgentLaunch,
    taskLifecycle,
    taskOutputBindings,
    taskService,
    win,
  } = args;
  if (!addon) {
    foregroundActivityService.panelClosed(
      createArgs.panelId,
      win ? String(win.id) : undefined
    );
    return { ok: false, error: loadError ?? "native addon not loaded" };
  }
  if (!win) {
    return { ok: false, error: "window not found" };
  }
  if (createArgs.taskOutput) {
    const parsed = taskOutputPanelParamsSchema.safeParse(createArgs.taskOutput);
    if (!parsed.success) {
      return { ok: false, error: "invalid task output parameters" };
    }
    if (!taskOutputBindings) {
      return { ok: false, error: "task output service is unavailable" };
    }
    try {
      const nativePanelId = toNativePanelKey(win, createArgs.panelId);
      recordRendererTerminalRoute(win, "create", createArgs.panelId, {
        height: createArgs.frame.height,
        width: createArgs.frame.width,
        x: createArgs.frame.x,
        y: createArgs.frame.y,
      });
      const ok = addon.createOutputTerminal(
        win.getNativeWindowHandle(),
        nativePanelId,
        createArgs.frame,
        createArgs.font.family,
        createArgs.font.size,
        createArgs.presentationId ?? 0
      );
      if (!ok) {
        return { ok: false, error: "createOutputTerminal returned false" };
      }
      const attached = taskOutputBindings.attach({
        browserWindowId: win.id,
        nativePanelId,
        ownerWindowId: findInternalWindowId(win) ?? undefined,
        params: parsed.data,
      });
      if (!attached.ok) {
        terminalFocusCoordinator.surfaceWillClose(win, createArgs.panelId);
        addon.closeTerminal(nativePanelId);
        return {
          ok: false,
          error: attached.error ?? "task output binding failed",
        };
      }
      terminalFocusCoordinator.surfaceCreated(win, createArgs.panelId);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  const sessionScope = windowRecordIdFor(win);
  let restoredAgentLaunch = false;
  try {
    const handle = win.getNativeWindowHandle();
    const saved = await readTerminalPanelSession(
      sessionScope,
      createArgs.panelId
    );
    const windowId = findInternalWindowId(win) ?? undefined;
    const taskLive = taskService
      ? isPanelTaskLive(
          taskService.runsSnapshot(windowId),
          createArgs.panelId,
          windowId
        )
      : false;
    const launch = resolveCreateTerminalLaunch(createArgs, saved, { taskLive });
    restoredAgentLaunch = Boolean(launch.restoredAgentLaunch);
    const lifecycleId = launch.task?.runId ?? "";
    taskLifecycle.resetPanel(
      createArgs.panelId,
      lifecycleId,
      findInternalWindowId(win) ?? undefined
    );
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
    const restoreCwd = launch.context?.cwd ?? launch.restoredAgent?.launch.cwd;
    const resumeLaunch = launch.restoredAgent
      ? resolveAgentResumeLaunch({
          agent: launch.restoredAgent,
          cwd: restoreCwd ?? launch.nativeLaunch?.cwd,
        })
      : null;
    let agentRestore: TerminalAgentRestoreOutcome | undefined;
    // Default spawn: pin-id resume command, else original launch.
    let nativeLaunchBase = resumeLaunch?.launch ?? launch.nativeLaunch;
    if (resumeLaunch) {
      if (resumeLaunch.resumed) {
        agentRestore = "resumed";
      } else if (resumeLaunch.reason === "unsupported-agent") {
        agentRestore = "unsupported";
      } else {
        // missing-session-id / missing-launch-command: prefer agent-native
        // folder-latest on the *first* spawn so we do not create a fresh
        // session that becomes "latest" before the user can continue.
        const restored = launch.restoredAgent;
        const lastLaunch = restored
          ? resolveAgentResumeLastLaunch({
              agentId: restored.agentId,
              cwd: restoreCwd ?? restored.launch.cwd,
              launch: restored.launch,
            })
          : null;
        if (lastLaunch?.command) {
          nativeLaunchBase = lastLaunch;
          agentRestore = "resumed";
        } else {
          agentRestore = "cold-start";
        }
      }
    }
    let launchForNative = nativeLaunchBase;
    if (launch.restoredAgentLaunch) {
      const projectEnv = localEnvironments
        ? await resolveProjectEnvForSpawn({
            cwd: nativeLaunchBase?.cwd ?? launch.context?.cwd,
            localEnvironments,
            projectRootPath: launch.context?.projectRootPath,
          })
        : undefined;
      launchForNative = await resolveRestoredAgentLaunchEnv(
        nativeLaunchBase,
        processEnvironment,
        {
          ...(projectEnv ? { projectEnv } : {}),
        }
      );
    }
    await persistInitialTerminalAgent(
      sessionScope,
      createArgs.panelId,
      launch.launchAgentId,
      launch.restoredAgent?.launch ?? launchForNative,
      {
        existing: launch.restoredAgent,
        resume: launch.restoredAgent?.resume,
        restoredAgentLaunch: launch.restoredAgentLaunch,
      }
    );
    const nativePanelId = toNativePanelKey(win, createArgs.panelId);
    const transfer = getTerminalPanelTransfer();
    const runtimeWindowId = findInternalWindowId(win) ?? undefined;
    const transferBeforeGate = resolveTerminalTransferCreateAction(
      transfer,
      runtimeWindowId,
      createArgs.panelId
    );
    if (transferBeforeGate === "skip") {
      // Target is inert during lease — do not create a competing surface.
      if (
        !transfer?.registerTargetPresentation(
          runtimeWindowId ?? "",
          createArgs.panelId,
          createArgs.presentationId ?? 0
        )
      ) {
        return { ok: false, error: "terminal transfer presentation rejected" };
      }
      return { ok: true };
    }
    if (transferBeforeGate === "adopt") {
      if (
        !transfer?.registerTargetPresentation(
          runtimeWindowId ?? "",
          createArgs.panelId,
          createArgs.presentationId ?? 0
        )
      ) {
        return { ok: false, error: "terminal transfer presentation rejected" };
      }
      terminalFocusCoordinator.surfaceCreated(win, createArgs.panelId);
      return { ok: true };
    }
    // Best-effort project-skills projection before native spawn. Opening an
    // agent is never a skills hygiene decision — never refuse create or show
    // a launch dialog. Project identity comes from the main-resolved native
    // launch cwd — never treat renderer createArgs.context as final authority.
    if (launchGate && launch.launchAgentId) {
      const launchSurface = {
        kind: "terminal" as const,
        panelId: createArgs.panelId,
        ...(windowId === undefined ? {} : { windowId }),
      };
      const launchEnvironmentCandidate =
        launchForNative && "env" in launchForNative
          ? launchForNative.env
          : undefined;
      const launchEnvironment = isStringRecord(launchEnvironmentCandidate)
        ? launchEnvironmentCandidate
        : undefined;
      const launchSpecification = {
        ...(launchForNative?.command === undefined
          ? {}
          : { command: launchForNative.command }),
        ...(launchForNative?.cwd === undefined
          ? {}
          : { cwd: launchForNative.cwd }),
        ...(launchEnvironment === undefined ? {} : { env: launchEnvironment }),
        ...(createArgs.initialInput === undefined
          ? {}
          : { initialInput: createArgs.initialInput }),
      };
      const projectRootPath = launchForNative?.cwd;
      await launchGate.ensureReady({
        agentId: launch.launchAgentId,
        launchSpecification,
        ...(projectRootPath === undefined ? {} : { projectRootPath }),
        surface: launchSurface,
      });
    }
    // Re-check after skills best-effort awaits: a cross-window drag may have
    // entered leased/moving while ensureReady was in flight.
    const transferAfterGate = resolveTerminalTransferCreateAction(
      transfer,
      runtimeWindowId,
      createArgs.panelId
    );
    if (transferAfterGate === "skip") {
      if (
        !transfer?.registerTargetPresentation(
          runtimeWindowId ?? "",
          createArgs.panelId,
          createArgs.presentationId ?? 0
        )
      ) {
        return { ok: false, error: "terminal transfer presentation rejected" };
      }
      return { ok: true };
    }
    if (transferAfterGate === "adopt") {
      if (
        !transfer?.registerTargetPresentation(
          runtimeWindowId ?? "",
          createArgs.panelId,
          createArgs.presentationId ?? 0
        )
      ) {
        return { ok: false, error: "terminal transfer presentation rejected" };
      }
      terminalFocusCoordinator.surfaceCreated(win, createArgs.panelId);
      return { ok: true };
    }
    // Last-mile agent resolve + thin wrap (do not persist this form).
    const launchForCreate = await withAgentLoginShellSafeCommand(
      launchForNative,
      launch.launchAgentId
    );
    // 不向终端注入 caller binding / 凭证：本机 CLI 不按「权限主体」管理智能体。
    // withPanelStatusEnv 仍剥离父进程残留的 binding 环境变量，避免误传。
    const ok = await createTerminalAndSeedResource({
      create: () =>
        addon.createTerminal(
          handle,
          nativePanelId,
          createArgs.frame,
          createArgs.font.family,
          createArgs.font.size,
          withPanelStatusEnv(
            launchForCreate,
            createArgs.panelId,
            String(win.id),
            foregroundActivityService.hookEnv()
          ),
          lifecycleId,
          createArgs.presentationId ?? 0
        ),
      panelId: createArgs.panelId,
      windowId: String(win.id),
    });
    if (!ok) {
      foregroundActivityService.panelClosed(createArgs.panelId, String(win.id));
      if (!restoredAgentLaunch) {
        await clearTerminalPanelAgent(sessionScope, createArgs.panelId);
      }
      return { ok: false, error: "createTerminal returned false" };
    }
    // exitPresentation lives on panel params; renderer resolves final copy on
    // child-exited and calls injectDisplayText (native does not i18n).
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
    // Invariant: live terminal ⇒ session entry exists (transfer CAS relies on
    // it). Context/tab writers below only add metadata onto this entry.
    await ensureTerminalPanelSession(sessionScope, createArgs.panelId);
    if (launch.launchAgentId) {
      const session = await readTerminalPanelSession(
        sessionScope,
        createArgs.panelId
      );
      const title = session?.sessionTitle?.trim();
      const source = session?.sessionTitleSource;
      if (title && source) {
        foregroundActivityService.hydrateAgentSessionTitle(
          String(win.id),
          createArgs.panelId,
          {
            source,
            ...(session.sessionTitleSessionId
              ? { sessionId: session.sessionTitleSessionId }
              : {}),
            title,
          }
        );
      }
    }
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
    terminalFocusCoordinator.surfaceCreated(win, createArgs.panelId);
    return {
      ok: true,
      ...(agentRestore === undefined ? {} : { agentRestore }),
    };
  } catch (err) {
    foregroundActivityService.panelClosed(createArgs.panelId, String(win.id));
    if (!restoredAgentLaunch) {
      await clearTerminalPanelAgent(sessionScope, createArgs.panelId);
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
