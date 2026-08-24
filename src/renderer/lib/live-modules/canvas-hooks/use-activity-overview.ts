import type { ActivityOverviewCounts } from "@shared/activity-overview.ts";
import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import { emptyTaskRunsSnapshot } from "@shared/contracts/tasks.ts";
import { combinedActivityRows } from "@shared/task-activity-sources.ts";
import { useMemo } from "react";
import {
  activityCounts,
  useForegroundActivityStore,
} from "@/stores/foreground-activity.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";
import { activityWindowScope } from "./window-scope.ts";

/** `pier/canvas` 本窗活动总览 hook 的结构化返回。 */
export interface CanvasActivityOverview {
  counts: ActivityOverviewCounts;
  rows: ForegroundActivity[];
}

/**
 * 本窗活动总览：计数（running / needsYou / inProgress）+ 活跃行。
 * 与标题栏计数有意分叉，语义见 `activityCounts`；TaskRuns 过滤带
 * `windowId` 防跨窗泄漏。
 */
export function useActivityOverview(): CanvasActivityOverview {
  const activities = useForegroundActivityStore((s) => s.activities);
  const taskRuns = useTaskRunsStore((s) => s.snapshot);
  const windowScope = activityWindowScope();
  const counts = useMemo(
    () => activityCounts(activities, taskRuns, windowScope),
    [activities, taskRuns, windowScope]
  );
  const rows = useMemo<ForegroundActivity[]>(
    () =>
      combinedActivityRows(
        activities,
        taskRuns ?? emptyTaskRunsSnapshot(),
        windowScope
      ),
    [activities, taskRuns, windowScope]
  );
  return { counts, rows };
}
