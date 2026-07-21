import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  isPanelTaskLive,
  taskOutputPanelParamsSchema,
} from "@shared/contracts/tasks.ts";
import type {
  CreateTerminalArgs,
  CreateTerminalResult,
} from "@shared/contracts/terminal.ts";
import { resolveAgentResumeLaunch } from "../services/agents/agent-resume-adapters.ts";
import { getTerminalPanelTransfer } from "../services/panel-transfer/terminal-panel-transfer.ts";
import type { ProcessEnvironmentService } from "../services/process-environment-service.ts";
import type { ManagedAgentLaunchGate } from "../services/project-skills/launch-gate.ts";
import type { TaskService } from "../services/tasks/task-service-types.ts";
import {
  clearTerminalPanelAgent,
  ensureTerminalPanelSession,
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
import { sendInitialTerminalInput } from "./terminal-create-post-actions.ts";
import { recordRendererTerminalRoute } from "./terminal-debug.ts";
import { terminalFocusCoordinator } from "./terminal-focus-coordinator.ts";
import {
  persistInitialTerminalAgent,
  persistInitialTerminalContext,
  persistInitialTerminalTask,
} from "./terminal-initial-session.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { toNativePanelKey } from "./terminal-panel-id.ts";
import { persistInitialTerminalTab } from "./terminal-tab-chrome.ts";
import type { RegisteredTerminalTaskLifecycle } from "./terminal-task-lifecycle-wiring.ts";
import type { TaskOutputTerminalBindings } from "./terminal-task-output-bindings.ts";
import { windowRecordIdFor } from "./terminal-window-scope.ts";

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
        createArgs.font.size
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
      {
        existing: launch.restoredAgent,
        resume: launch.restoredAgent?.resume,
        restoredAgentLaunch: launch.restoredAgentLaunch,
      }
    );
    const nativePanelId = toNativePanelKey(win, createArgs.panelId);
    const transfer = getTerminalPanelTransfer();
    const runtimeWindowId = findInternalWindowId(win) ?? undefined;
    if (
      transfer &&
      runtimeWindowId &&
      transfer.shouldSkipTargetCreate(runtimeWindowId, createArgs.panelId)
    ) {
      // Target is inert during lease — do not create a competing surface.
      return { ok: true };
    }
    if (
      transfer &&
      runtimeWindowId &&
      transfer.shouldAdoptMovedSurface(runtimeWindowId, createArgs.panelId)
    ) {
      // Surface already moved under this native key — register focus only.
      terminalFocusCoordinator.surfaceCreated(win, createArgs.panelId);
      return { ok: true };
    }
    // Managed agent launches must pass project-skills gate before native spawn.
    // Project identity comes from the main-resolved native launch cwd —
    // never treat renderer createArgs.context as final authority (v8 §5.2).
    let spawnedUnderAttemptId: string | null = null;
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
      if (createArgs.skillsLaunchContinuation) {
        // Continuation handshake (design v8 §5.2.7): admit exactly while the
        // attempt sits in the durable SPAWN_INTENT window; no re-gating, no
        // new attempt, no replay after consumption.
        const authorization = await launchGate.authorizeSpawn(
          createArgs.skillsLaunchContinuation,
          {
            agentId: launch.launchAgentId,
            launchSpecification,
            ...(projectRootPath === undefined ? {} : { projectRootPath }),
            surface: launchSurface,
          }
        );
        if (!authorization.ok) {
          if (!restoredAgentLaunch) {
            await clearTerminalPanelAgent(sessionScope, createArgs.panelId);
          }
          foregroundActivityService.panelClosed(
            createArgs.panelId,
            String(win.id)
          );
          return {
            ok: false,
            error: `launch continuation rejected: ${authorization.message}`,
          };
        }
        spawnedUnderAttemptId = createArgs.skillsLaunchContinuation;
      } else {
        const gate = await launchGate.ensureReady({
          agentId: launch.launchAgentId,
          launchSpecification,
          ...(projectRootPath === undefined ? {} : { projectRootPath }),
          surface: launchSurface,
        });
        if (gate.status === "blocked") {
          if (!restoredAgentLaunch) {
            await clearTerminalPanelAgent(sessionScope, createArgs.panelId);
          }
          foregroundActivityService.panelClosed(
            createArgs.panelId,
            String(win.id)
          );
          return {
            ok: false,
            error: "skills-launch-blocked",
            skillsLaunchBlocked: {
              launchAttemptId: gate.launchAttemptId,
              issueSummary: gate.issueSummary,
              ...(gate.issues === undefined
                ? {}
                : {
                    focusIssueIds: gate.issues.map((issue) => issue.id),
                    issues: gate.issues.map((issue) => ({
                      id: issue.id,
                      code: issue.code,
                      ...(issue.skillId === undefined
                        ? {}
                        : { skillId: issue.skillId }),
                      ...(issue.adapterKind === undefined
                        ? {}
                        : { adapterKind: issue.adapterKind }),
                      ...(issue.relativeTarget === undefined
                        ? {}
                        : { relativeTarget: issue.relativeTarget }),
                    })),
                  }),
              degradePolicySummary: gate.degradePolicySummary,
              expiresAt: gate.expiresAt,
              ...(gate.contentRiskRequirementId === undefined
                ? {}
                : {
                    contentRiskRequirementId: gate.contentRiskRequirementId,
                  }),
              ...(gate.projectRootPath === undefined
                ? {}
                : { projectRootPath: gate.projectRootPath }),
            },
          };
        }
      }
    }
    let ok: boolean;
    try {
      ok = addon.createTerminal(
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
        ),
        lifecycleId
      );
    } catch (error) {
      if (spawnedUnderAttemptId && launchGate) {
        await launchGate
          .recordSpawnResult(spawnedUnderAttemptId, false)
          .catch(() => undefined);
      }
      throw error;
    }
    if (spawnedUnderAttemptId && launchGate) {
      // Durable SPAWN_ACCEPTED / SPAWN_FAILED after the actual spawn attempt;
      // any replay of the same attempt is rejected from here on.
      await launchGate
        .recordSpawnResult(spawnedUnderAttemptId, ok)
        .catch(() => undefined);
    }
    if (!ok) {
      foregroundActivityService.panelClosed(createArgs.panelId, String(win.id));
      if (!restoredAgentLaunch) {
        await clearTerminalPanelAgent(sessionScope, createArgs.panelId);
      }
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
    // Invariant: live terminal ⇒ session entry exists (transfer CAS relies on
    // it). Context/tab writers below only add metadata onto this entry.
    await ensureTerminalPanelSession(sessionScope, createArgs.panelId);
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
    return { ok: true };
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
