import { panelContextSchema } from "@shared/contracts/panel.ts";
import type {
  TaskOutputPanelParams,
  TaskRunControlEntry,
} from "@shared/contracts/tasks.ts";
import i18next from "i18next";
import {
  nextTaskOutputBinding,
  openTaskOutputPanel,
  rebindTaskOutputPanel,
  taskOutputPanelsForRun,
} from "@/components/workspace/open-task-output-panel.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

type WorkspaceApi = NonNullable<
  ReturnType<typeof useWorkspaceStore.getState>["api"]
>;

interface DeferredSurfaceClose {
  close: (() => void) | undefined;
  guards: Set<symbol>;
}

const deferredSurfaceClosesByPanel = new Map<string, DeferredSurfaceClose>();

export function requestTaskOutputSurfaceClose(
  panelId: string,
  close: () => void
): void {
  const pending = deferredSurfaceClosesByPanel.get(panelId);
  if (!pending) {
    close();
    return;
  }
  pending.close ??= close;
}

export function beginTaskOutputRestartSurfaceCloseGuard(
  previousRun: TaskRunControlEntry
): (rebindSucceeded: boolean) => void {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    return () => undefined;
  }
  const token = Symbol(previousRun.runId);
  const panelIds = taskOutputPanelsForRun(
    api,
    previousRun.runId,
    previousRun.rootTaskId
  ).map((binding) => binding.panelId);
  for (const panelId of panelIds) {
    const pending = deferredSurfaceClosesByPanel.get(panelId) ?? {
      close: undefined,
      guards: new Set<symbol>(),
    };
    pending.guards.add(token);
    deferredSurfaceClosesByPanel.set(panelId, pending);
  }

  let finished = false;
  return (rebindSucceeded) => {
    if (finished) {
      return;
    }
    finished = true;
    for (const panelId of panelIds) {
      const pending = deferredSurfaceClosesByPanel.get(panelId);
      if (!pending) {
        continue;
      }
      if (rebindSucceeded) {
        pending.close = undefined;
      }
      pending.guards.delete(token);
      if (pending.guards.size > 0) {
        continue;
      }
      deferredSurfaceClosesByPanel.delete(panelId);
      if (!rebindSucceeded) {
        pending.close?.();
      }
    }
  };
}

function taskOutputViewIdentity(
  api: WorkspaceApi,
  projectRootPath: string,
  run?: TaskRunControlEntry
): { contextId: string } {
  const candidatePanelIds = run
    ? [
        run.originPanelId,
        run.nodes[run.rootTaskId]?.panelId,
        ...Object.values(run.nodes).map((node) => node.panelId),
      ]
    : [];
  for (const panelId of candidatePanelIds) {
    if (!panelId) {
      continue;
    }
    const panel = api.panels.find((candidate) => candidate.id === panelId);
    const params = panel?.params;
    if (!(params && typeof params === "object" && "context" in params)) {
      continue;
    }
    const context = panelContextSchema.safeParse(params.context);
    if (context.success) {
      return { contextId: context.data.contextId };
    }
  }
  // CLI/旧布局可能没有可追溯的 PanelContext；路径锚点只作为兼容身份，
  // 一旦从带 context 的 panel 打开或重绑就会写入真实 contextId。
  return { contextId: `path:${projectRootPath}` };
}

export async function rebindRestartedTaskOutput(args: {
  current: TaskOutputPanelParams;
  panelId: string;
  projectRootPath: string;
  run?: TaskRunControlEntry;
  runId: string;
}): Promise<{
  error?: string;
  next?: TaskOutputPanelParams;
  ok: boolean;
}> {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    return {
      error: i18next.t("terminal.runtimeControl.revealUnavailableBody"),
      ok: false,
    };
  }
  try {
    const identity = taskOutputViewIdentity(
      api,
      args.projectRootPath,
      args.run
    );
    const next = nextTaskOutputBinding(args.current, args.runId, {
      contextId: identity.contextId,
      projectRootPath: args.projectRootPath,
    });
    const result = await rebindTaskOutputPanel(api, args.panelId, next);
    return result.ok ? { next, ok: true } : result;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  }
}

/**
 * 从发起终端重新运行后台任务时，同步重绑所有仍展示旧 runId 的已打开输出视图。
 * 未打开输出视图时是成功的空操作，不会擅自创建 Panel。
 */
export async function rebindOpenTaskOutputsAfterRestart(args: {
  previousRun: TaskRunControlEntry;
  runId: string;
}): Promise<{ error?: string; ok: boolean }> {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    return {
      error: i18next.t("terminal.runtimeControl.revealUnavailableBody"),
      ok: false,
    };
  }
  const bindings = taskOutputPanelsForRun(
    api,
    args.previousRun.runId,
    args.previousRun.rootTaskId
  );
  const applied: Array<{
    next: TaskOutputPanelParams;
    panelId: string;
  }> = [];
  for (const binding of bindings) {
    const rebound = await rebindRestartedTaskOutput({
      current: binding.params,
      panelId: binding.panelId,
      projectRootPath: args.previousRun.projectRootPath,
      run: args.previousRun,
      runId: args.runId,
    });
    if (!rebound.ok) {
      const rollbackFailures: string[] = [];
      for (const previous of applied.toReversed()) {
        const rollback = await rebindRestartedTaskOutput({
          current: previous.next,
          panelId: previous.panelId,
          projectRootPath: args.previousRun.projectRootPath,
          run: args.previousRun,
          runId: args.previousRun.runId,
        });
        if (!rollback.ok) {
          rollbackFailures.push(
            rollback.error ?? `rollback failed: ${previous.panelId}`
          );
        }
      }
      return {
        error: [rebound.error, ...rollbackFailures].filter(Boolean).join("\n"),
        ok: false,
      };
    }
    if (rebound.next) {
      applied.push({ next: rebound.next, panelId: binding.panelId });
    }
  }
  return { ok: true };
}

export async function openTaskRunOutput(
  run: TaskRunControlEntry,
  label: string
): Promise<boolean> {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    await showAppAlert({
      body: i18next.t("terminal.runtimeControl.revealUnavailableBody"),
      title: i18next.t("terminal.runtimeControl.openOutputFailed"),
    });
    return false;
  }
  try {
    const identity = taskOutputViewIdentity(api, run.projectRootPath, run);
    const result = await openTaskOutputPanel(api, {
      contextId: identity.contextId,
      generation: 0,
      label,
      projectRootPath: run.projectRootPath,
      selectedRunId: run.runId,
      taskId: run.rootTaskId,
      version: 2,
    });
    if (!result.ok) {
      await showAppAlert({
        body: result.message,
        title: i18next.t("terminal.runtimeControl.openOutputFailed"),
      });
      return false;
    }
    return true;
  } catch (error) {
    await showAppAlert({
      body: error instanceof Error ? error.message : String(error),
      title: i18next.t("terminal.runtimeControl.openOutputFailed"),
    });
    return false;
  }
}
