import { panelContextSchema } from "@shared/contracts/panel.ts";
import {
  committedTaskOutputRunId,
  preferredBackgroundRunForOutputRebind,
  selectedTaskOutputRunId,
  type TaskOutputPanelParams,
  type TaskOutputPanelParamsV2,
  type TaskRunControlEntry,
  type TaskRunsSnapshot,
  taskOutputBindingGeneration,
  taskOutputPanelParamsSchema,
} from "@shared/contracts/tasks.ts";
import type { DockviewApi } from "dockview-react";
import {
  type ActivateWorkspacePanelResult,
  activateWorkspacePanel,
} from "@/lib/workspace/panel-activation.ts";
import { scheduleRevealDockviewTabByPanelId } from "@/lib/workspace/tab-visibility.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

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

function pathContextId(projectRootPath: string): string {
  return `path:${projectRootPath}`;
}

function isPathScopedContextId(contextId: string): boolean {
  return contextId.startsWith("path:");
}

function taskOutputScopeKey(
  output: Pick<
    TaskOutputPanelParamsV2,
    "instanceId" | "projectRootPath" | "taskId"
  >
): string {
  return `${output.projectRootPath}\0${output.taskId}\0${output.instanceId ?? ""}`;
}

function upgradeTaskOutputContextId(
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

function findMergeableTaskOutputPanel(
  api: Pick<DockviewApi, "panels">,
  params: TaskOutputPanelParamsV2
): TaskOutputPanelLike | undefined {
  return api.panels.find((candidate) => {
    const output = taskOutputFromPanel(candidate as TaskOutputPanelLike);
    return output ? mergeableLogicalView(output, params) : false;
  }) as TaskOutputPanelLike | undefined;
}

function panelPreferenceScore(output: TaskOutputPanelParams): number {
  let score = 0;
  if ("contextId" in output && !isPathScopedContextId(output.contextId)) {
    score += 4;
  } else if ("contextId" in output) {
    score += 2;
  }
  score += taskOutputBindingGeneration(output);
  return score;
}

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
