import { isPanelTaskLive } from "@shared/contracts/tasks.ts";
import type { CreateTerminalResult } from "@shared/contracts/terminal.ts";
import { app } from "electron";
import { agentRestoreCreateFields } from "../../services/agents/resume-adapters.ts";
import { getTerminalPanelTransfer } from "../../services/panel-transfer/terminal.ts";
import { createTerminalAndSeedResource } from "../../services/pier-resource/claim-login-after-create.ts";
import {
  applyLaunchWrapForCreate,
  applyWrapT1,
  readUserDataControlSocketPath,
} from "../../services/terminal-launch-wrap/index.ts";
import { terminalDraftStore } from "../../state/terminal-drafts/index.ts";
import {
  clearTerminalPanelAgent,
  readTerminalPanelSession,
  recordTerminalPanelAgentSpawnGeneration,
} from "../../state/terminal-session-state.ts";
import { findInternalWindowId } from "../../windows/identity.ts";
import { foregroundActivityService } from "../foreground-activity.ts";
import { hydrateNativeLaunchEnv, isStringRecord } from "./create-env.ts";
import {
  consumeCreateLaunch,
  resolveAgentSpawnLifecycle,
  resolveCreateTerminalLaunch,
  withAgentLoginShellSafeCommand,
  withAgentSpawnGenerationEnv,
} from "./create-launch.ts";
import {
  handleInitialInputInjectFailed,
  sendInitialTerminalInput,
} from "./create-post-actions.ts";
import {
  resolveRestoredAgentNativeLaunch,
  shouldLatchResumePending,
} from "./create-restore.ts";
import { resolveTerminalTransferCreateAction } from "./create-transfer-guard.ts";
import { handleTerminalCreateFailure } from "./creation/failure.ts";
import type { TerminalCreateOptions } from "./creation/options.ts";
import { createTaskOutputTerminal } from "./creation/output.ts";
import { adoptTerminalReceipt } from "./creation/receipt.ts";
import { serializeTerminalCreate } from "./creation/serial.ts";
import { prepareTerminalSessionMetadata } from "./creation/session.ts";
import { recordRendererTerminalRoute } from "./debug.ts";
import {
  prepareInitialAgentInput,
  settleInitialInputCheckpoint,
} from "./drafts/initial-input.ts";
import { terminalFocusCoordinator } from "./focus-coordinator.ts";
import {
  persistInitialTerminalAgent,
  persistInitialTerminalTask,
} from "./initial-session.ts";
import { toNativePanelKey } from "./panel-id.ts";
import {
  type NativeTerminalProcess,
  nativeTerminalProcesses,
} from "./process/registry.ts";
import { windowRecordIdFor } from "./window-scope.ts";

export function handleTerminalCreate(
  args: TerminalCreateOptions
): Promise<CreateTerminalResult> {
  const key = args.win
    ? toNativePanelKey(args.win, args.createArgs.panelId)
    : args.createArgs.panelId;
  const isCurrent = nativeTerminalProcesses.creationGuard(key);
  return serializeTerminalCreate(key, isCurrent, () =>
    createTerminalImpl(args, isCurrent)
  );
}
async function createTerminalImpl(
  args: TerminalCreateOptions,
  creationIsCurrent: () => boolean
): Promise<CreateTerminalResult> {
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
  if (createArgs.taskOutput)
    return createTaskOutputTerminal({
      addon,
      createArgs,
      taskOutputBindings,
      win,
    });
  const sessionScope = windowRecordIdFor(win);
  const assertCreation = () => {
    if (!creationIsCurrent() || win.isDestroyed())
      throw new Error("terminal closed or moved before launch");
  };
  let restoredAgentLaunch = false;
  let nativeProcess: NativeTerminalProcess | undefined;
  let settleInitialInput: ((created: boolean) => Promise<void>) | undefined;
  try {
    const nativePanelId = toNativePanelKey(win, createArgs.panelId);
    assertCreation();
    const existingProcess = nativeTerminalProcesses.get(nativePanelId);
    if (
      existingProcess?.stopping &&
      !existingProcess.exited &&
      !existingProcess.closed
    )
      throw new Error("terminal is stopping; wait for exit before restarting");
    resolveTerminalTransferCreateAction(
      getTerminalPanelTransfer(),
      findInternalWindowId(win) ?? undefined,
      createArgs.panelId
    );
    const adopted = adoptTerminalReceipt(
      addon,
      win,
      createArgs,
      existingProcess
    );
    if (adopted) return adopted;
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
    assertCreation();
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
    const { agentRestore, nativeLaunchBase, restoreCwd } =
      resolveRestoredAgentNativeLaunch({
        contextCwd: launch.context?.cwd,
        nativeLaunch: launch.nativeLaunch,
        restoredAgent: launch.restoredAgent,
      });
    // Overlay login-shell dump for spawn; persist the logical launch.
    const launchForNative = await hydrateNativeLaunchEnv(
      nativeLaunchBase,
      processEnvironment,
      {
        localEnvironments,
        projectRootPath: launch.context?.projectRootPath,
      }
    );
    assertCreation();
    await persistInitialTerminalAgent(
      sessionScope,
      createArgs.panelId,
      launch.launchAgentId,
      launch.restoredAgent?.launch ?? nativeLaunchBase,
      {
        existing: launch.restoredAgent,
        resume: launch.restoredAgent?.resume,
        restoredAgentLaunch: launch.restoredAgentLaunch,
      }
    );
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
        ...(createArgs.initialInput === undefined &&
        launch.initialInput === undefined
          ? {}
          : {
              initialInput: createArgs.initialInput ?? launch.initialInput,
            }),
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
    assertCreation();
    nativeProcess = nativeTerminalProcesses.begin(nativePanelId, {
      savedGeneration: saved?.agent?.restore?.spawnGeneration,
      lifecycleId:
        launch.task?.runId ?? (launch.launchAgentId ? undefined : ""),
      launchId: createArgs.launchId,
    });
    terminalDraftStore().reopen(sessionScope, createArgs.panelId);
    const nextSpawnGeneration = nativeProcess.generation;
    const spawnLifecycle = resolveAgentSpawnLifecycle({
      launchAgentId: launch.launchAgentId,
      spawnGeneration: nextSpawnGeneration,
      taskRunId: launch.task?.runId,
    });
    const lifecycleId = nativeProcess.lifecycleId;
    taskLifecycle.resetPanel(
      createArgs.panelId,
      lifecycleId,
      windowId,
      spawnLifecycle.surface
    );
    assertCreation();
    const wrapped = await applyWrapT1({
      ...launchForNative,
      ...(launch.launchAgentId ? { agentId: launch.launchAgentId } : {}),
    });
    assertCreation();
    const preparedInput = await prepareInitialAgentInput({
      agentId: launch.launchAgentId,
      initialInput: createArgs.initialInput ?? launch.initialInput,
      launch: wrapped.launch,
      launchId:
        createArgs.launchId ??
        `${sessionScope}:${createArgs.panelId}:${nextSpawnGeneration}`,
      panelId: createArgs.panelId,
      submit: createArgs.initialInputSubmit,
      win,
    });
    nativeProcess.inputDisposition = preparedInput.disposition;
    settleInitialInput = preparedInput.settle;
    const surface = await withAgentLoginShellSafeCommand(
      preparedInput.launch,
      launch.launchAgentId
    );
    const launchForCreate = surface.launch;
    const spawnLaunch = await applyLaunchWrapForCreate({
      agentId: launch.launchAgentId,
      decorateSpawn: wrapped.decorateSpawn,
      controlSocketPath: readUserDataControlSocketPath(() =>
        app.getPath("userData")
      ),
      hookEnv: withAgentSpawnGenerationEnv(
        foregroundActivityService.hookEnv(),
        launch.launchAgentId,
        nextSpawnGeneration,
        sessionScope
      ),
      launch: launchForCreate,
      panelId: createArgs.panelId,
      userData: app.getPath("userData"),
      windowId: String(win.id),
    });
    if (launch.launchAgentId) {
      // Persist the identity before native callbacks can report a fast exit.
      assertCreation();
      await recordTerminalPanelAgentSpawnGeneration(
        sessionScope,
        createArgs.panelId,
        nextSpawnGeneration,
        {
          resumePending: shouldLatchResumePending({
            agentRestore,
            restoredAgent: launch.restoredAgent,
          }),
        }
      );
      foregroundActivityService.agentLaunched(
        String(win.id),
        createArgs.panelId,
        launch.launchAgentId
      );
    }
    await prepareTerminalSessionMetadata({
      panelId: createArgs.panelId,
      sessionScope,
      windowId: String(win.id),
      agentId: launch.launchAgentId,
      context: launch.context,
      tab: createArgs.tab,
      assertCurrent: assertCreation,
    });
    assertCreation();
    const processReceipt = nativeProcess;
    const ok = await createTerminalAndSeedResource({
      create: () => {
        assertCreation();
        if (
          !nativeTerminalProcesses.isCurrent(processReceipt) ||
          processReceipt.closed ||
          win.isDestroyed() ||
          processReceipt.nativePanelId !== nativePanelId
        )
          throw new Error("terminal closed or moved before launch");
        const created = addon.createTerminal(
          handle,
          nativePanelId,
          createArgs.frame,
          createArgs.font.family,
          createArgs.font.size,
          spawnLaunch,
          lifecycleId,
          createArgs.presentationId ?? 0
        );
        if (created) nativeTerminalProcesses.created(processReceipt);
        else
          nativeTerminalProcesses.failed(
            processReceipt,
            "createTerminal returned false"
          );
        return created;
      },
      panelId: createArgs.panelId,
      windowId: String(win.id),
    });
    const inputWarning = await settleInitialInputCheckpoint(
      nativeProcess,
      settleInitialInput,
      ok
    );
    settleInitialInput = undefined;
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
      initialInput: launch.launchAgentId
        ? undefined
        : (createArgs.initialInput ?? launch.initialInput),
      nativePanelId,
      onFailed: (detail) => {
        if (win.isDestroyed() || win.webContents.isDestroyed()) {
          return;
        }
        handleInitialInputInjectFailed({
          browserWindowId: win.id,
          completeFromExitCodeHint: (hint) =>
            taskLifecycle.completeFromExitCodeHint(hint),
          hasAgent: Boolean(launch.launchAgentId),
          lifecycleId,
          panelId: createArgs.panelId,
          sendFailed: (event) =>
            win.webContents.send("pier:terminal:initial-input-failed", event),
          taskStatus: launch.task?.status,
          textDelivered: detail?.textDelivered === true,
          windowId,
        });
      },
      panelId: createArgs.panelId,
      submit: createArgs.initialInputSubmit,
    });
    if (
      launch.launchAgentId &&
      !launch.restoredAgentLaunch &&
      recordAgentLaunch
    ) {
      try {
        await recordAgentLaunch(launch.launchAgentId);
      } catch (err) {
        // 使用偏好是非关键记录，不得让已成功创建的终端反向失败。
        console.warn("[agent-usage] record launch failed:", err);
      }
    }
    terminalFocusCoordinator.surfaceCreated(win, createArgs.panelId);
    return {
      ok: true,
      generation: nativeProcess.generation,
      lifecycleId: nativeProcess.lifecycleId,
      inputWarning,
      ...agentRestoreCreateFields({
        agentRestore,
        cwd: restoreCwd,
        restoredAgent: launch.restoredAgent,
      }),
    };
  } catch (err) {
    return handleTerminalCreateFailure({
      err,
      settleInitialInput,
      nativeProcess,
      creationIsCurrent,
      restoredAgentLaunch,
      sessionScope,
      panelId: createArgs.panelId,
      win,
    });
  } finally {
    consumeCreateLaunch(createArgs);
  }
}
