import {
  selectedTaskOutputRunId,
  type TaskOutputPanelParams,
  type TaskOutputPanelParamsV2,
  taskOutputBindingGeneration,
  taskOutputPanelParamsSchema,
} from "@shared/contracts/tasks.ts";
import type { DockviewApi } from "dockview-react";
import {
  type ActivateWorkspacePanelResult,
  activateWorkspacePanel,
} from "@/lib/workspace/panel-activation.ts";
import { scheduleRevealDockviewTabByPanelId } from "@/lib/workspace/tab-visibility.ts";

interface TaskOutputPanelLike {
  api: {
    setActive(): void;
    updateParameters(params: Record<string, unknown>): void;
  };
  id: string;
  params?: unknown;
  view: { contentComponent: string };
}

export interface RebindTaskOutputPanelResult {
  error?: string;
  ok: boolean;
}

export interface TaskOutputPanelBinding {
  panelId: string;
  params: TaskOutputPanelParams;
}

export type OpenTaskOutputPanelResult =
  | ActivateWorkspacePanelResult
  | { code: "rebind_failed"; message: string; ok: false };

function taskOutputFromPanel(
  panel: TaskOutputPanelLike
): TaskOutputPanelParams | null {
  if (
    !(
      panel.params &&
      typeof panel.params === "object" &&
      "taskOutput" in panel.params
    )
  ) {
    return null;
  }
  const parsed = taskOutputPanelParamsSchema.safeParse(panel.params.taskOutput);
  return parsed.success ? parsed.data : null;
}

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

function sameLogicalView(
  left: TaskOutputPanelParams,
  right: TaskOutputPanelParams
): boolean {
  if ("contextId" in left && "contextId" in right) {
    return (
      left.contextId === right.contextId &&
      left.taskId === right.taskId &&
      left.instanceId === right.instanceId
    );
  }
  // v1 没有 contextId；runId 在 TaskService 进程内全局唯一，因此只有同一次
  // run + task 才允许视为同一逻辑视图，避免跨工作区误合并。
  return (
    !("contextId" in left) &&
    left.taskId === right.taskId &&
    selectedTaskOutputRunId(left) === selectedTaskOutputRunId(right)
  );
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

export function nextTaskOutputBinding(
  current: TaskOutputPanelParams,
  selectedRunId: string,
  identity?: {
    contextId: string;
    projectRootPath: string;
  }
): TaskOutputPanelParamsV2 {
  const contextId =
    "contextId" in current ? current.contextId : identity?.contextId;
  const projectRootPath =
    "projectRootPath" in current
      ? current.projectRootPath
      : identity?.projectRootPath;
  if (!(contextId && projectRootPath)) {
    throw new Error("task output view identity is unavailable");
  }
  return {
    contextId,
    generation: taskOutputBindingGeneration(current) + 1,
    ...("instanceId" in current && current.instanceId
      ? { instanceId: current.instanceId }
      : {}),
    label: current.label,
    projectRootPath,
    selectedRunId,
    taskId: current.taskId,
    version: 2,
  };
}

/**
 * 同一逻辑 Task Output view 的显式重绑定入口。
 *
 * 顺序固定为 native adapter 成功 → dockview 参数提交；adapter 失败时视图参数
 * 保持旧值。极少数参数提交异常会用更高 generation 尽力补偿回旧运行。
 */
export async function rebindTaskOutputPanel(
  api: DockviewApi,
  panelId: string,
  next: TaskOutputPanelParamsV2
): Promise<RebindTaskOutputPanelResult> {
  const panel = api.panels.find((candidate) => candidate.id === panelId) as
    | TaskOutputPanelLike
    | undefined;
  if (!panel) {
    return { ok: false, error: `panel not found: ${panelId}` };
  }
  const current = taskOutputFromPanel(panel);
  if (!current) {
    return { ok: false, error: `panel is not a task output view: ${panelId}` };
  }
  if (
    selectedTaskOutputRunId(current) === next.selectedRunId &&
    taskOutputBindingGeneration(current) >= next.generation
  ) {
    return { ok: true };
  }

  const result = await window.pier.terminal.rebindTaskOutput(panelId, next);
  if (!result.ok) {
    return { ok: false, error: result.error ?? "task output rebind failed" };
  }
  if (result.stale) {
    return { ok: false, error: "task output rebind was superseded" };
  }

  const rootParams =
    panel.params && typeof panel.params === "object"
      ? (panel.params as Record<string, unknown>)
      : {};
  try {
    panel.api.updateParameters({
      ...rootParams,
      tab: {
        icon: { id: "pier.task", label: "Task" },
        title: next.label,
      },
      taskOutput: next,
    });
  } catch (error) {
    const rollback = nextTaskOutputBinding(
      next,
      selectedTaskOutputRunId(current)
    );
    const rollbackResult = await window.pier.terminal.rebindTaskOutput(
      panelId,
      rollback
    );
    if (rollbackResult.ok && !rollbackResult.stale) {
      try {
        panel.api.updateParameters({
          ...rootParams,
          taskOutput: rollback,
        });
      } catch {
        // dockview 参数提交持续失败时无法再建立可靠视图状态；调用方会展示原错误。
      }
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return { ok: true };
}

/** 工作区内任务输出面板的唯一创建入口：同一逻辑任务默认复用 dedicated view。 */
export async function openTaskOutputPanel(
  api: DockviewApi,
  params: TaskOutputPanelParamsV2
): Promise<OpenTaskOutputPanelResult> {
  const existing = api.panels.find((candidate) => {
    const output = taskOutputFromPanel(candidate as TaskOutputPanelLike);
    return output ? sameLogicalView(output, params) : false;
  }) as TaskOutputPanelLike | undefined;

  if (existing) {
    const current = taskOutputFromPanel(existing);
    if (!current) {
      return {
        code: "rebind_failed",
        message: `task output parameters disappeared: ${existing.id}`,
        ok: false,
      };
    }
    if (
      !("contextId" in current) ||
      selectedTaskOutputRunId(current) !== params.selectedRunId
    ) {
      const rebound = await rebindTaskOutputPanel(
        api,
        existing.id,
        nextTaskOutputBinding(current, params.selectedRunId, params)
      );
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

  const id = taskOutputPanelId(params);
  const activeGroup = api.activeGroup;
  api.addPanel({
    component: "terminal",
    id,
    params: {
      tab: {
        icon: { id: "pier.task", label: "Task" },
        title: params.label,
      },
      taskOutput: params,
    },
    title: params.label,
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
