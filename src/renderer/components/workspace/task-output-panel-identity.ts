import { panelContextSchema } from "@shared/contracts/panel.ts";
import {
  selectedTaskOutputRunId,
  type TaskOutputPanelParams,
  type TaskOutputPanelParamsV2,
  type TaskRunControlEntry,
  taskOutputBindingGeneration,
  taskOutputPanelParamsSchema,
} from "@shared/contracts/tasks.ts";
import type { DockviewApi } from "dockview-react";

export interface TaskOutputPanelLike {
  api: {
    setActive(): void;
    updateParameters(params: Record<string, unknown>): void;
  };
  id: string;
  params?: unknown;
  view: { contentComponent: string };
}

export function taskOutputFromPanel(
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

function pathContextId(projectRootPath: string): string {
  return `path:${projectRootPath}`;
}

function isPathScopedContextId(contextId: string): boolean {
  return contextId.startsWith("path:");
}

export function taskOutputScopeKey(
  output: Pick<
    TaskOutputPanelParamsV2,
    "instanceId" | "projectRootPath" | "taskId"
  >
): string {
  return `${output.projectRootPath}\0${output.taskId}\0${output.instanceId ?? ""}`;
}

export function upgradeTaskOutputContextId(
  params: TaskOutputPanelParamsV2,
  resolvedContextId: string
): TaskOutputPanelParamsV2 {
  if (
    isPathScopedContextId(params.contextId) &&
    !isPathScopedContextId(resolvedContextId)
  ) {
    return { ...params, contextId: resolvedContextId };
  }
  return params;
}

/** 从工作区面板解析逻辑任务输出的稳定 contextId。 */
export function resolveTaskOutputContextId(
  api: Pick<DockviewApi, "panels">,
  projectRootPath: string,
  taskId: string,
  run?: TaskRunControlEntry
): string {
  if (!taskId) {
    return pathContextId(projectRootPath);
  }
  const candidatePanelIds = run
    ? [
        run.originPanelId,
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
      return context.data.contextId;
    }
  }
  for (const candidate of api.panels) {
    const output = taskOutputFromPanel(candidate as TaskOutputPanelLike);
    if (
      output &&
      "contextId" in output &&
      output.projectRootPath === projectRootPath &&
      output.taskId === taskId &&
      !isPathScopedContextId(output.contextId)
    ) {
      return output.contextId;
    }
  }
  return pathContextId(projectRootPath);
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

function mergeableLogicalView(
  existing: TaskOutputPanelParams,
  target: TaskOutputPanelParamsV2
): boolean {
  if (sameLogicalView(existing, target)) {
    return true;
  }
  if (!("contextId" in existing && "contextId" in target)) {
    return sameLogicalView(existing, target);
  }
  if (existing.taskId !== target.taskId) {
    return false;
  }
  if (existing.instanceId !== target.instanceId) {
    return false;
  }
  if (existing.projectRootPath !== target.projectRootPath) {
    return false;
  }
  const pathId = pathContextId(target.projectRootPath);
  return (
    existing.contextId === pathId ||
    target.contextId === pathId ||
    existing.contextId === target.contextId
  );
}

export function findMergeableTaskOutputPanel(
  api: Pick<DockviewApi, "panels">,
  params: TaskOutputPanelParamsV2
): TaskOutputPanelLike | undefined {
  return api.panels.find((candidate) => {
    const output = taskOutputFromPanel(candidate as TaskOutputPanelLike);
    return output ? mergeableLogicalView(output, params) : false;
  }) as TaskOutputPanelLike | undefined;
}

export function panelPreferenceScore(output: TaskOutputPanelParams): number {
  let score = 0;
  if ("contextId" in output && !output.contextId.startsWith("path:")) {
    score += 4;
  } else if ("contextId" in output) {
    score += 2;
  }
  score += taskOutputBindingGeneration(output);
  return score;
}
