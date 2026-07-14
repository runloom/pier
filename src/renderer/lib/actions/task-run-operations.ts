import {
  TASK_STOP_GRACE_MS,
  type TaskRunControlEntry,
} from "@shared/contracts/tasks.ts";
import i18next from "i18next";
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";
import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { spawnTaskWithInputResolution } from "./task-input-flow.ts";
import {
  beginTaskOutputRestartSurfaceCloseGuard,
  rebindOpenTaskOutputsAfterRestart,
  rebindRestartedTaskOutput,
} from "./task-output-run-operations.ts";
import { scheduleTaskOutputPanelSync } from "./task-output-sync.ts";
import {
  restartOperationKey,
  type TaskRunActionTarget,
} from "./task-run-action-target.ts";

export interface RestartTaskRunResult {
  panelRebound: boolean;
  runId: string;
}

const restartOperationsByRun = new Map<
  string,
  Promise<RestartTaskRunResult | null>
>();

async function retryFailedOutputRebind(
  error: string | undefined,
  retry: () => Promise<{ error?: string; ok: boolean }>
): Promise<boolean> {
  const confirmed = await showAppConfirm({
    body: error ?? "task output rebind failed",
    cancelLabel: i18next.t("terminal.runtimeControl.stateUnavailableDismiss"),
    confirmLabel: i18next.t("terminal.runtimeControl.stateUnavailableRetry"),
    intent: "default",
    size: "default",
    title: i18next.t("terminal.runtimeControl.openOutputFailed"),
  });
  if (!confirmed) {
    return false;
  }
  const result = await retry();
  if (result.ok) {
    return true;
  }
  await showAppAlert({
    body: result.error ?? "task output rebind failed",
    title: i18next.t("terminal.runtimeControl.openOutputFailed"),
  });
  return false;
}

export function forceStopAvailable(
  run: TaskRunControlEntry,
  now: number
): boolean {
  const stopping = Object.values(run.nodes).filter(
    (node) => node.status === "stopping"
  );
  return (
    stopping.length > 0 &&
    stopping.every(
      (node) =>
        node.stopRequestedAt !== undefined &&
        now - node.stopRequestedAt >= TASK_STOP_GRACE_MS
    )
  );
}

export async function stopTaskRun(
  run: TaskRunControlEntry,
  force: boolean
): Promise<void> {
  if (force) {
    const confirmed = await showAppConfirm({
      body: i18next.t("terminal.runtimeControl.forceStopBody"),
      confirmLabel: i18next.t("terminal.runtimeControl.forceStopConfirm"),
      intent: "destructive",
      size: "sm",
      title: i18next.t("terminal.runtimeControl.forceStopTitle"),
    });
    if (!confirmed) {
      return;
    }
  }
  try {
    const result = await window.pier.tasks.stop({ force, runId: run.runId });
    if (result.failures.length > 0) {
      await showAppAlert({
        body: result.failures.map((failure) => failure.message).join("\n"),
        title: i18next.t("terminal.runtimeControl.stopFailed"),
      });
    }
  } catch (error) {
    await showAppAlert({
      body: error instanceof Error ? error.message : String(error),
      title: i18next.t("terminal.runtimeControl.stopFailed"),
    });
  }
}

async function executeRestartTaskRun(
  target: TaskRunActionTarget
): Promise<RestartTaskRunResult | null> {
  let outputRebindSucceeded = false;
  let panelRebound = false;
  const finishOutputRestartGuard =
    target.mode === "background" && target.run
      ? beginTaskOutputRestartSurfaceCloseGuard(target.run)
      : undefined;
  try {
    const terminalPanelId =
      target.mode === "background"
        ? target.run?.originPanelId
        : (target.relaunchPanelId ?? (target.run ? undefined : target.panelId));
    const spawn = (inputs?: Record<string, string>) =>
      window.pier.tasks.spawn({
        focus: target.mode !== "background",
        forceRestart: true,
        ...(inputs ? { inputs } : {}),
        mode: target.mode,
        placement: "active-tab",
        projectRootPath: target.projectRootPath,
        taskId: target.taskId,
        ...(terminalPanelId ? { terminalPanelId } : {}),
      });
    const result = await spawnTaskWithInputResolution(spawn);
    if (!result) {
      return null;
    }
    if (result.status === "unsupported") {
      await showAppAlert({
        body: result.message,
        title: i18next.t("terminal.runtimeControl.startFailed"),
      });
      return null;
    }
    if (result.status === "requires-input") {
      await showAppAlert({
        body: i18next.t("terminal.runtimeControl.inputResolutionFailed"),
        title: i18next.t("terminal.runtimeControl.startFailed"),
      });
      return null;
    }
    if (result.status !== "started") {
      await showAppAlert({
        body: i18next.t("terminal.runtimeControl.missingRunIdentity"),
        title: i18next.t("terminal.runtimeControl.startFailed"),
      });
      return null;
    }
    const runId = result.runId ?? result.snapshot?.runId;
    if (!runId) {
      await showAppAlert({
        body: i18next.t("terminal.runtimeControl.missingRunIdentity"),
        title: i18next.t("terminal.runtimeControl.startFailed"),
      });
      return null;
    }

    if (target.mode === "background" && target.run) {
      const previousRun = target.run;
      const rebind = () =>
        rebindOpenTaskOutputsAfterRestart({
          previousRun,
          runId,
        });
      const rebound = await rebind();
      outputRebindSucceeded =
        rebound.ok || (await retryFailedOutputRebind(rebound.error, rebind));
      panelRebound = outputRebindSucceeded;
      if (!outputRebindSucceeded) {
        scheduleTaskOutputPanelSync();
        return { panelRebound: false, runId };
      }
    } else if (target.taskOutput) {
      const currentOutput = target.taskOutput;
      const rebind = () =>
        rebindRestartedTaskOutput({
          current: currentOutput,
          panelId: target.panelId,
          projectRootPath: target.projectRootPath,
          ...(target.run ? { run: target.run } : {}),
          runId,
        });
      const rebound = await rebind();
      panelRebound =
        rebound.ok || (await retryFailedOutputRebind(rebound.error, rebind));
      if (!panelRebound) {
        scheduleTaskOutputPanelSync();
        return { panelRebound: false, runId };
      }
    }
    scheduleTaskOutputPanelSync();
    return { panelRebound, runId };
  } catch (error) {
    await showAppAlert({
      body: error instanceof Error ? error.message : String(error),
      title: i18next.t("terminal.runtimeControl.startFailed"),
    });
    return null;
  } finally {
    finishOutputRestartGuard?.(outputRebindSucceeded);
  }
}

/** 所有按钮、快捷键和右键菜单按业务运行去重，跨 Panel 也只能触发一次 spawn。 */
export function restartTaskRun(
  target: TaskRunActionTarget
): Promise<RestartTaskRunResult | null> {
  const operationKey = restartOperationKey(target);
  const existing = restartOperationsByRun.get(operationKey);
  if (existing) {
    return existing;
  }
  const operation = executeRestartTaskRun(target).finally(() => {
    if (restartOperationsByRun.get(operationKey) === operation) {
      restartOperationsByRun.delete(operationKey);
    }
  });
  restartOperationsByRun.set(operationKey, operation);
  return operation;
}

export async function revealTaskRun(
  run: TaskRunControlEntry
): Promise<boolean> {
  const panelId =
    run.nodes[run.rootTaskId]?.panelId ??
    Object.values(run.nodes).find((candidate) => candidate.panelId)?.panelId;
  const api = useWorkspaceStore.getState().api;
  if (!(api && panelId)) {
    await showAppAlert({
      body: i18next.t("terminal.runtimeControl.revealUnavailableBody"),
      title: i18next.t("terminal.runtimeControl.revealFailed"),
    });
    return false;
  }
  const result = activateWorkspacePanel(api, panelId, { reveal: "always" });
  if (!result.ok) {
    await showAppAlert({
      body: result.message,
      title: i18next.t("terminal.runtimeControl.revealFailed"),
    });
    return false;
  }
  return true;
}

export { openTaskRunOutput } from "./task-output-run-operations.ts";
export {
  isTaskRunPanelParams,
  resolveTaskRunActionTarget,
  restartOperationKey,
  type TaskRunActionTarget,
  taskRunActionTargetFromRun,
} from "./task-run-action-target.ts";
