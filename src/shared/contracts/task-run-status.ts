import { z } from "zod";
import type { PanelTabState } from "./panel.ts";
import type {
  TaskOutputPanelParams,
  TaskOutputPanelParamsV2,
  TaskRunControlEntry,
  TaskRunId,
  TaskRunNodeStatus,
  TaskRunsSnapshot,
} from "./task-run-snapshot.ts";
import { taskRunControlEntrySchema } from "./task-run-snapshot.ts";
import type { TaskBackgroundSnapshot } from "./tasks.ts";

export function selectedTaskOutputRunId(
  params: TaskOutputPanelParams
): TaskRunId {
  return "selectedRunId" in params ? params.selectedRunId : params.runId;
}

export function taskOutputBindingGeneration(
  params: TaskOutputPanelParams
): number {
  return "generation" in params ? params.generation : 0;
}

export function isActiveTaskRunNodeStatus(status: TaskRunNodeStatus): boolean {
  return status === "pending" || status === "running" || status === "stopping";
}

/**
 * Task run UI 金标准（三层模型）：
 *
 * 1. **TaskRunsSnapshot** — 系统里哪些 run 存在、处于什么状态（活体注册表）
 * 2. **Committed view binding** — `params.selectedRunId` + main native binding；
 *    仅通过 `rebindTaskOutput` 原子更新（native 成功 → dockview params）
 * 3. **Presentation** — 对 committed runId 在 snapshot 中查状态；**禁止 preview 未提交的 run**
 *
 * Task Output 逻辑视图只跟随 `mode === "background"` 的 run（输出在 buffer，不在 PTY）。
 * 任务终端 tab 的状态只读 `taskRunsOwnedByPanel(snapshot, panelId)`；
 * background 的 originPanelId 只驱动 RC，不污染发起终端的 tab 状态。
 */

/** Task Output 面板当前 committed 的 run（= params，与 main binding 对齐）。 */
export function committedTaskOutputRunId(
  params: TaskOutputPanelParams
): TaskRunId {
  return selectedTaskOutputRunId(params);
}

/** 同一逻辑后台任务输出视图应跟随的最新活跃 background run。 */
export function preferredActiveBackgroundRunForOutput(
  snapshot: TaskRunsSnapshot,
  output: Pick<TaskOutputPanelParamsV2, "projectRootPath" | "taskId">
): TaskRunControlEntry | undefined {
  return Object.values(snapshot.runs)
    .filter(
      (run) =>
        run.mode === "background" &&
        run.projectRootPath === output.projectRootPath &&
        run.rootTaskId === output.taskId &&
        isActiveTaskRunNodeStatus(run.status)
    )
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt ||
        right.startedAt - left.startedAt ||
        left.runId.localeCompare(right.runId)
    )[0];
}

/**
 * 若已打开的输出视图应 rebind 到新的 background run，返回目标 run；
 * 否则 undefined（committed binding 仍有效）。
 */
export function preferredBackgroundRunForOutputRebind(
  output: TaskOutputPanelParams,
  snapshot: TaskRunsSnapshot
): TaskRunControlEntry | undefined {
  const committed = committedTaskOutputRunId(output);
  const projectRootPath =
    "projectRootPath" in output
      ? output.projectRootPath
      : snapshot.runs[committed]?.projectRootPath;
  if (!projectRootPath) {
    return;
  }
  const preferred = preferredActiveBackgroundRunForOutput(snapshot, {
    projectRootPath,
    taskId: output.taskId,
  });
  if (!preferred || preferred.runId === committed) {
    return;
  }
  const committedRun = snapshot.runs[committed];
  if (
    committedRun &&
    isActiveTaskRunNodeStatus(committedRun.status) &&
    committedRun.mode === "background" &&
    committedRun.updatedAt >= preferred.updatedAt
  ) {
    return;
  }
  return preferred;
}

/** TaskRun 状态 → tab 指示器（活体 UI 与 Archive tab patch 共用）。 */
export function taskRunTabState(
  status: TaskRunNodeStatus,
  exitCode?: number
): PanelTabState {
  switch (status) {
    case "pending":
      return { label: "Pending", status: "waiting" };
    case "running":
      return { label: "Running", status: "running" };
    case "stopping":
      return { label: "Stopping", status: "waiting" };
    case "succeeded":
      return { colorToken: "success", label: "Succeeded", status };
    case "failed":
      return {
        colorToken: "destructive",
        label: exitCode === undefined ? "Failed" : `Failed ${exitCode}`,
        status,
      };
    case "blocked":
      return { colorToken: "warning", label: "Blocked", status };
    default:
      return { colorToken: "warning", label: "Cancelled", status };
  }
}

/**
 * renderer reload 是否应挂真 PTY（非 Archive 结果卡）。
 * 只认 node.panelId；background 的 originPanelId 不占用 origin 终端 PTY。
 */
export function isPanelTaskLive(
  snapshot: TaskRunsSnapshot,
  panelId: string,
  windowId?: string
): boolean {
  return Object.values(snapshot.runs).some((run) => {
    if (windowId && run.ownerWindowId && run.ownerWindowId !== windowId) {
      return false;
    }
    return Object.values(run.nodes).some(
      (node) =>
        node.panelId === panelId && isActiveTaskRunNodeStatus(node.status)
    );
  });
}

export function activeTaskRunCount(
  snapshot: TaskRunsSnapshot,
  windowId?: string
): number {
  return Object.values(snapshot.runs).filter((run) => {
    if (windowId && run.ownerWindowId && run.ownerWindowId !== windowId) {
      return false;
    }
    return isActiveTaskRunNodeStatus(run.status);
  }).length;
}

/** backgroundSnapshot 从 TaskRuns 派生，禁止第二份 status 镜像。 */
export function deriveBackgroundSnapshot(
  snapshot: TaskRunsSnapshot
): TaskBackgroundSnapshot {
  const runs: TaskBackgroundSnapshot["runs"] = {};
  for (const run of Object.values(snapshot.runs)) {
    if (run.mode !== "background") {
      continue;
    }
    for (const node of Object.values(run.nodes)) {
      const projectRuns = runs[run.projectRootPath] ?? {};
      projectRuns[node.taskId] = {
        label: node.label,
        projectRootPath: run.projectRootPath,
        runId: run.runId,
        startedAt: run.startedAt,
        status: node.status,
        taskId: node.taskId,
        updatedAt: run.updatedAt,
        ...(node.exitCode === undefined ? {} : { exitCode: node.exitCode }),
        ...(node.windowId ? { windowId: node.windowId } : {}),
        ...(isActiveTaskRunNodeStatus(node.status)
          ? {}
          : { finishedAt: run.updatedAt }),
      };
      runs[run.projectRootPath] = projectRuns;
    }
  }
  return { runs, version: snapshot.version };
}

export const taskStopResultSchema = z
  .object({
    failures: z.array(
      z
        .object({
          message: z.string().min(1),
          taskId: z.string().min(1),
        })
        .strict()
    ),
    snapshot: taskRunControlEntrySchema,
    status: z.enum([
      "already-finished",
      "cancelled",
      "force-stopped",
      "partially-stopping",
      "rejected",
      "stopping",
    ]),
  })
  .strict();
export type TaskStopResult = z.infer<typeof taskStopResultSchema>;
