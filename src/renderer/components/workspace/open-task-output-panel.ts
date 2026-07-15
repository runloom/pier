import {
  committedTaskOutputRunId,
  selectedTaskOutputRunId,
  type TaskOutputPanelParams,
  type TaskOutputPanelParamsV2,
} from "@shared/contracts/tasks.ts";
import type { DockviewApi } from "dockview-react";
import {
  type ActivateWorkspacePanelResult,
  activateWorkspacePanel,
} from "@/lib/workspace/panel-activation.ts";
import { scheduleRevealDockviewTabByPanelId } from "@/lib/workspace/tab-visibility.ts";
import {
  findMergeableTaskOutputPanel,
  resolveTaskOutputContextId,
  type TaskOutputPanelLike,
  taskOutputFromPanel,
  upgradeTaskOutputContextId,
} from "./task-output-panel-identity.ts";
import {
  nextTaskOutputBinding,
  rebindTaskOutputPanel,
} from "./task-output-panel-rebind.ts";

export {
  resolveTaskOutputContextId,
  taskOutputFromPanel,
} from "./task-output-panel-identity.ts";
export type { RebindTaskOutputPanelResult } from "./task-output-panel-rebind.ts";
export {
  nextTaskOutputBinding,
  rebindTaskOutputPanel,
} from "./task-output-panel-rebind.ts";
export {
  maintainTaskOutputPanels,
  syncTaskOutputPanelsToActiveRuns,
} from "./task-output-panel-sync.ts";

export interface TaskOutputPanelBinding {
  panelId: string;
  params: TaskOutputPanelParams;
}

export type OpenTaskOutputPanelResult =
  | ActivateWorkspacePanelResult
  | { code: "rebind_failed"; message: string; ok: false };

/** 查找当前仍展示指定运行的 Task Output 视图；重新运行只重绑这些视图。 */
export function taskOutputPanelsForRun(
  api: Pick<DockviewApi, "panels">,
  runId: string,
  taskId: string
): TaskOutputPanelBinding[] {
  return api.panels.flatMap((candidate) => {
    const panel = candidate as TaskOutputPanelLike;
    const params = taskOutputFromPanel(panel);
    return params &&
      params.taskId === taskId &&
      selectedTaskOutputRunId(params) === runId
      ? [{ panelId: panel.id, params }]
      : [];
  });
}

export function taskOutputPanelId(params: TaskOutputPanelParams): string {
  if ("contextId" in params) {
    const instance = params.instanceId
      ? `-${encodeURIComponent(params.instanceId)}`
      : "";
    return `task-output-${encodeURIComponent(params.contextId)}-${encodeURIComponent(params.taskId)}${instance}`;
  }
  // 旧布局保持原 id 可读；首次重绑后参数会迁移到 v2，新建面板不再走此分支。
  return `task-output-${encodeURIComponent(params.runId)}-${encodeURIComponent(params.taskId)}`;
}

/** 工作区内任务输出面板的唯一创建入口：同一逻辑任务默认复用 dedicated view。 */
export async function openTaskOutputPanel(
  api: DockviewApi,
  params: TaskOutputPanelParamsV2
): Promise<OpenTaskOutputPanelResult> {
  const resolvedParams = upgradeTaskOutputContextId(
    params,
    resolveTaskOutputContextId(api, params.projectRootPath, params.taskId)
  );
  const existing = findMergeableTaskOutputPanel(api, resolvedParams);

  if (existing) {
    const current = taskOutputFromPanel(existing);
    if (!current) {
      return {
        code: "rebind_failed",
        message: `task output parameters disappeared: ${existing.id}`,
        ok: false,
      };
    }
    const next = nextTaskOutputBinding(
      current,
      resolvedParams.selectedRunId,
      resolvedParams
    );
    const upgraded = upgradeTaskOutputContextId(next, resolvedParams.contextId);
    if (
      !("contextId" in current) ||
      committedTaskOutputRunId(current) !== upgraded.selectedRunId ||
      upgraded.contextId !== ("contextId" in current ? current.contextId : "")
    ) {
      const rebound = await rebindTaskOutputPanel(api, existing.id, upgraded);
      if (!rebound.ok) {
        return {
          code: "rebind_failed",
          message: rebound.error ?? "task output rebind failed",
          ok: false,
        };
      }
    }
    return activateWorkspacePanel(api, existing.id, { reveal: "always" });
  }

  const id = taskOutputPanelId(resolvedParams);
  const activeGroup = api.activeGroup;
  api.addPanel({
    component: "terminal",
    id,
    params: {
      tab: {
        icon: { id: "pier.task", label: "Task" },
        title: params.label,
      },
      taskOutput: resolvedParams,
    },
    title: resolvedParams.label,
    ...(activeGroup
      ? {
          position: {
            direction: "within" as const,
            referenceGroup: activeGroup,
          },
        }
      : {}),
  });
  scheduleRevealDockviewTabByPanelId(id);
  return activateWorkspacePanel(api, id, { reveal: "always" });
}
