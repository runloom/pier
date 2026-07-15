import type { QuitActivitySummary } from "./contracts/app-quit.ts";
import type {
  ForegroundActivity,
  TaskActivity,
} from "./contracts/foreground-activity.ts";
import {
  isActiveTaskRunNodeStatus,
  type TaskRunNodeStatus,
  type TaskRunsSnapshot,
} from "./contracts/tasks.ts";

function matchesWindow(
  run: TaskRunsSnapshot["runs"][string],
  windowId?: string
): boolean {
  return !(windowId && run.ownerWindowId) || run.ownerWindowId === windowId;
}

function foregroundTaskKeys(
  activities: readonly ForegroundActivity[]
): Set<string> {
  return new Set(
    activities
      .filter((activity): activity is TaskActivity => activity.kind === "task")
      .map(
        (activity) =>
          `${activity.windowId}:${activity.panelId}:${activity.runId}`
      )
  );
}

/** TaskRuns 中某 run/node 的状态；优先 node 级。 */
export function taskNodeStatusForActivity(
  snapshot: TaskRunsSnapshot,
  runId: string,
  taskId: string
): TaskRunNodeStatus | undefined {
  const run = snapshot.runs[runId];
  if (!run) {
    return;
  }
  return run.nodes[taskId]?.status ?? run.status;
}

/**
 * FA 未覆盖的活跃 task 占用（主要是 background run）。
 * terminal-tab 已由 onLaunched 写入 FA，此处按 runId+panelId 去重。
 */
export function activeTaskActivitiesNotInForeground(
  taskRuns: TaskRunsSnapshot,
  activities: readonly ForegroundActivity[],
  options?: { windowId?: string }
): TaskActivity[] {
  const covered = foregroundTaskKeys(activities);
  const coveredRunIds = new Set(
    activities
      .filter((activity): activity is TaskActivity => activity.kind === "task")
      .map((activity) => activity.runId)
  );
  const result: TaskActivity[] = [];

  for (const run of Object.values(taskRuns.runs)) {
    if (!isActiveTaskRunNodeStatus(run.status)) {
      continue;
    }
    if (!matchesWindow(run, options?.windowId)) {
      continue;
    }

    if (run.mode === "background") {
      if (coveredRunIds.has(run.runId)) {
        continue;
      }
      const rootNode = run.nodes[run.rootTaskId] ?? Object.values(run.nodes)[0];
      if (!rootNode) {
        continue;
      }
      const panelId = run.originPanelId ?? rootNode.panelId ?? run.runId;
      const windowId = run.ownerWindowId ?? rootNode.windowId;
      if (!windowId) {
        continue;
      }
      const key = `${windowId}:${panelId}:${run.runId}`;
      if (covered.has(key)) {
        continue;
      }
      covered.add(key);
      coveredRunIds.add(run.runId);
      result.push({
        kind: "task",
        label: rootNode.label,
        panelId,
        runId: run.runId,
        spawnedAt: run.startedAt,
        taskId: rootNode.taskId,
        updatedAt: run.updatedAt,
        windowId,
      });
      continue;
    }

    for (const node of Object.values(run.nodes)) {
      if (!isActiveTaskRunNodeStatus(node.status)) {
        continue;
      }
      if (!(node.panelId && node.windowId)) {
        continue;
      }
      const key = `${node.windowId}:${node.panelId}:${run.runId}`;
      if (covered.has(key)) {
        continue;
      }
      covered.add(key);
      result.push({
        kind: "task",
        label: node.label,
        panelId: node.panelId,
        runId: run.runId,
        spawnedAt: run.startedAt,
        taskId: node.taskId,
        updatedAt: run.updatedAt,
        windowId: node.windowId,
      });
    }
  }

  return result;
}

/** MC / 指标用：FA 非 idle 行 + TaskRuns 补全的活跃 task。 */
export function combinedActivityRows(
  activities: Record<string, ForegroundActivity>,
  taskRuns: TaskRunsSnapshot,
  options?: { windowId?: string }
): ForegroundActivity[] {
  const rows = Object.values(activities).filter(
    (activity) => activity.kind !== "idle"
  );
  const panelIds = new Set(rows.map((activity) => activity.panelId));
  for (const activity of activeTaskActivitiesNotInForeground(
    taskRuns,
    rows,
    options
  )) {
    if (panelIds.has(activity.panelId)) {
      continue;
    }
    rows.push(activity);
    panelIds.add(activity.panelId);
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function revealPanelIdForTaskActivity(
  activity: TaskActivity,
  taskRuns: TaskRunsSnapshot
): string {
  const run = taskRuns.runs[activity.runId];
  if (run?.mode === "background" && run.originPanelId) {
    return run.originPanelId;
  }
  return activity.panelId;
}

export function quitSummariesFromActiveTaskRuns(
  taskRuns: TaskRunsSnapshot,
  activities: readonly ForegroundActivity[]
): QuitActivitySummary[] {
  return activeTaskActivitiesNotInForeground(taskRuns, activities).map(
    (activity) => ({
      kind: "task",
      label: activity.label,
      panelId: activity.panelId,
      windowId: activity.windowId,
    })
  );
}

export function activityKindCounts(
  activities: Record<string, ForegroundActivity>,
  taskRuns: TaskRunsSnapshot,
  options?: { windowId?: string }
): Map<ForegroundActivity["kind"], number> {
  const counts = new Map<ForegroundActivity["kind"], number>();
  for (const activity of combinedActivityRows(activities, taskRuns, options)) {
    counts.set(activity.kind, (counts.get(activity.kind) ?? 0) + 1);
  }
  return counts;
}
