import {
  selectedTaskOutputRunId,
  type TaskOutputPanelParams,
  type TaskOutputPanelParamsV2,
  taskOutputBindingGeneration,
} from "@shared/contracts/tasks.ts";
import type { DockviewApi } from "dockview-react";
import {
  type TaskOutputPanelLike,
  taskOutputFromPanel,
} from "./task-output-panel-identity.ts";

export interface RebindTaskOutputPanelResult {
  error?: string;
  ok: boolean;
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
