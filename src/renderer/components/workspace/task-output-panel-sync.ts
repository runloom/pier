import {
  committedTaskOutputRunId,
  preferredBackgroundRunForOutputRebind,
  type TaskOutputPanelParams,
  type TaskOutputPanelParamsV2,
  type TaskRunsSnapshot,
  taskOutputBindingGeneration,
} from "@shared/contracts/tasks.ts";
import type { DockviewApi } from "dockview-react";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import {
  panelPreferenceScore,
  resolveTaskOutputContextId,
  type TaskOutputPanelLike,
  taskOutputFromPanel,
  taskOutputScopeKey,
  upgradeTaskOutputContextId,
} from "./task-output-panel-identity.ts";
import {
  nextTaskOutputBinding,
  rebindTaskOutputPanel,
} from "./task-output-panel-rebind.ts";

async function dedupeTaskOutputPanels(
  api: DockviewApi
): Promise<{ error?: string; ok: boolean }> {
  const groups = new Map<
    string,
    Array<{ output: TaskOutputPanelParamsV2; panel: TaskOutputPanelLike }>
  >();
  for (const candidate of api.panels) {
    const panel = candidate as TaskOutputPanelLike;
    const output = taskOutputFromPanel(panel);
    if (!(output && "projectRootPath" in output)) {
      continue;
    }
    const key = taskOutputScopeKey(output);
    const current = groups.get(key);
    const entry = { output, panel };
    if (current) {
      current.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  const closePanel = useWorkspaceStore.getState().closePanel;
  for (const entries of groups.values()) {
    if (entries.length <= 1) {
      continue;
    }
    const ordered = entries.toSorted(
      (left, right) =>
        panelPreferenceScore(right.output) - panelPreferenceScore(left.output)
    );
    const keeper = ordered[0];
    if (!keeper) {
      continue;
    }
    const resolvedContextId = resolveTaskOutputContextId(
      api,
      keeper.output.projectRootPath,
      keeper.output.taskId
    );
    const upgraded = upgradeTaskOutputContextId(
      keeper.output,
      resolvedContextId
    );
    if (upgraded.contextId !== keeper.output.contextId) {
      const rebound = await rebindTaskOutputPanel(
        api,
        keeper.panel.id,
        nextTaskOutputBinding(keeper.output, upgraded.selectedRunId, upgraded)
      );
      if (!rebound.ok) {
        return {
          error: rebound.error ?? "task output context upgrade failed",
          ok: false,
        };
      }
    }
    for (const duplicate of ordered.slice(1)) {
      await closePanel(duplicate.panel.id);
    }
  }
  return { ok: true };
}

/** layout load / spawn / TaskRuns 广播后的统一维护：去重 + context 升级 + rebind。 */
export async function maintainTaskOutputPanels(
  api: DockviewApi,
  snapshot: TaskRunsSnapshot
): Promise<{ error?: string; ok: boolean }> {
  const deduped = await dedupeTaskOutputPanels(api);
  if (!deduped.ok) {
    return deduped;
  }
  try {
    await syncTaskOutputPanelsToActiveRuns(api, snapshot);
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  }
}

const syncInFlight = new Set<string>();

/**
 * TaskRuns 广播后把仍打开的 Task Output 逻辑视图对齐到最新活跃 run。
 * 与显式 open/restart rebind 互补，覆盖「面板未关再次运行」路径。
 */
export async function syncTaskOutputPanelsToActiveRuns(
  api: DockviewApi,
  snapshot: TaskRunsSnapshot
): Promise<void> {
  for (const candidate of api.panels) {
    const panel = candidate as TaskOutputPanelLike;
    const current = taskOutputFromPanel(panel);
    if (!current) {
      continue;
    }
    const preferred = preferredBackgroundRunForOutputRebind(current, snapshot);
    if (!preferred) {
      continue;
    }
    if (syncInFlight.has(panel.id)) {
      continue;
    }
    syncInFlight.add(panel.id);
    try {
      const resolvedContextId = resolveTaskOutputContextId(
        api,
        preferred.projectRootPath,
        current.taskId,
        preferred
      );
      const bindingBase: TaskOutputPanelParams =
        "contextId" in current
          ? current
          : {
              contextId: resolvedContextId,
              generation: taskOutputBindingGeneration(current),
              label: current.label,
              projectRootPath: preferred.projectRootPath,
              selectedRunId: committedTaskOutputRunId(current),
              taskId: current.taskId,
              version: 2,
            };
      const next = upgradeTaskOutputContextId(
        nextTaskOutputBinding(bindingBase, preferred.runId, {
          contextId: resolvedContextId,
          projectRootPath: preferred.projectRootPath,
        }),
        resolvedContextId
      );
      await rebindTaskOutputPanel(api, panel.id, next);
    } finally {
      syncInFlight.delete(panel.id);
    }
  }
}
