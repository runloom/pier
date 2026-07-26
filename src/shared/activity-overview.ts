/**
 * 活动总览（本窗）计数与分组 — 纯函数，供 widget / metrics / 单测共用。
 * 范围始终是本窗 FA + TaskRuns 合并行；勿与本机 `agentIndexCounts` 混用。
 */

import type { ForegroundActivity } from "./contracts/foreground-activity.ts";
import {
  activeTaskRunCount,
  type TaskRunNodeStatus,
  type TaskRunsSnapshot,
} from "./contracts/tasks.ts";
import {
  combinedActivityRows,
  taskNodeStatusForActivity,
} from "./task-activity-sources.ts";

export type ActivityOverviewBucket = "needsYou" | "running" | "other";

export interface ActivityOverviewCounts {
  /** 列表行数（combinedActivityRows）。 */
  inProgress: number;
  /** agent waiting|error + task blocked|failed（出现在列表中时）。 */
  needsYou: number;
  /** agent processing|tool + 活跃 task run 数。 */
  running: number;
}

function taskNeedsYou(status: TaskRunNodeStatus | undefined): boolean {
  return status === "blocked" || status === "failed";
}

function taskRunning(status: TaskRunNodeStatus | undefined): boolean {
  return status === "pending" || status === "running" || status === "stopping";
}

/** 单行归属桶（agent / task / shell）。 */
export function activityOverviewBucket(
  activity: ForegroundActivity,
  taskRuns: TaskRunsSnapshot
): ActivityOverviewBucket {
  if (activity.kind === "agent") {
    if (activity.status === "waiting" || activity.status === "error") {
      return "needsYou";
    }
    if (activity.status === "processing" || activity.status === "tool") {
      return "running";
    }
    return "other";
  }
  if (activity.kind === "task") {
    const status = taskNodeStatusForActivity(
      taskRuns,
      activity.runId,
      activity.taskId
    );
    if (taskNeedsYou(status)) {
      return "needsYou";
    }
    if (taskRunning(status)) {
      return "running";
    }
    return "other";
  }
  // shell / idle
  return "other";
}

/**
 * 本窗活动总览 KPI。
 * - needsYou：本窗需介入（含 agent error；与标题栏 needsYou 语义对齐，范围仅本窗且含 task）
 * - running：有会话状态的推进 + 活跃 task（launch 无 status 不计 running）
 * - inProgress：合并列表行数
 */
export function activityOverviewCounts(
  activities: Record<string, ForegroundActivity>,
  taskRuns: TaskRunsSnapshot,
  options?: { windowId?: string }
): ActivityOverviewCounts {
  const rows = combinedActivityRows(activities, taskRuns, options);
  let needsYou = 0;
  let agentRunning = 0;

  for (const activity of rows) {
    if (activity.kind === "agent") {
      if (activity.status === "waiting" || activity.status === "error") {
        needsYou += 1;
      } else if (
        activity.status === "processing" ||
        activity.status === "tool"
      ) {
        agentRunning += 1;
      }
      continue;
    }
    if (activity.kind === "task") {
      const status = taskNodeStatusForActivity(
        taskRuns,
        activity.runId,
        activity.taskId
      );
      if (taskNeedsYou(status)) {
        needsYou += 1;
      }
    }
  }

  return {
    inProgress: rows.length,
    needsYou,
    // 与 rows 同 scope：有 windowId 时只计本窗 task runs，避免 multi-window 泄漏。
    running: agentRunning + activeTaskRunCount(taskRuns, options?.windowId),
  };
}

export interface GroupedActivityRows {
  needsYou: ForegroundActivity[];
  other: ForegroundActivity[];
  running: ForegroundActivity[];
}

function needsYouRank(activity: ForegroundActivity): number {
  if (activity.kind === "agent" && activity.status === "error") {
    return 0;
  }
  if (activity.kind === "task") {
    // failed 略高于 blocked 以便扫错误
    return 1;
  }
  return 2; // waiting 等
}

function sortBucket(
  rows: ForegroundActivity[],
  bucket: ActivityOverviewBucket
): ForegroundActivity[] {
  return [...rows].sort((a, b) => {
    if (bucket === "needsYou") {
      const rankDiff = needsYouRank(a) - needsYouRank(b);
      if (rankDiff !== 0) {
        return rankDiff;
      }
    }
    if (b.updatedAt !== a.updatedAt) {
      return b.updatedAt - a.updatedAt;
    }
    return a.panelId.localeCompare(b.panelId);
  });
}

/** 按注意力优先分桶并排序。空桶返回空数组（调用方不渲染分组标题）。 */
export function groupActivityOverviewRows(
  activities: Record<string, ForegroundActivity>,
  taskRuns: TaskRunsSnapshot,
  options?: { windowId?: string }
): GroupedActivityRows {
  const rows = combinedActivityRows(activities, taskRuns, options);
  const needsYou: ForegroundActivity[] = [];
  const running: ForegroundActivity[] = [];
  const other: ForegroundActivity[] = [];

  for (const row of rows) {
    const bucket = activityOverviewBucket(row, taskRuns);
    if (bucket === "needsYou") {
      needsYou.push(row);
    } else if (bucket === "running") {
      running.push(row);
    } else {
      other.push(row);
    }
  }

  return {
    needsYou: sortBucket(needsYou, "needsYou"),
    other: sortBucket(other, "other"),
    running: sortBucket(running, "running"),
  };
}

/** 展平分组顺序：needsYou → running → other（用于 compact 限行）。 */
export function flattenGroupedActivityRows(
  grouped: GroupedActivityRows
): ForegroundActivity[] {
  return [...grouped.needsYou, ...grouped.running, ...grouped.other];
}
