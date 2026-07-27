import {
  type ActivityOverviewCounts,
  activityOverviewCounts,
} from "@shared/activity-overview.ts";
import type {
  ForegroundActivity,
  ForegroundActivityBroadcast,
} from "@shared/contracts/foreground-activity.ts";
import {
  emptyTaskRunsSnapshot,
  type TaskRunsSnapshot,
} from "@shared/contracts/tasks.ts";
import { create } from "zustand";

interface ForegroundActivityState {
  /** panelId → activity。 */
  activities: Record<string, ForegroundActivity>;
  apply: (b: ForegroundActivityBroadcast) => void;
  ts: number;
}

/**
 * ForegroundActivity 镜像 — main aggregator 快照的 renderer 副本。
 * 写入方: ForegroundActivityBridge (初始 snapshot pull + 广播 push)。
 * 读取方: TerminalPanel（activity overlay）、AgentStatusItem、TitleBar 计数。
 * ts 单调守卫拒收乱序广播（main 端 broadcastSeq 保证严格递增）。
 */
export const useForegroundActivityStore = create<ForegroundActivityState>(
  (set, get) => ({
    activities: {},
    ts: 0,
    apply: (b) => {
      if (b.ts <= get().ts) {
        return;
      }
      set({
        activities: Object.fromEntries(b.activities.map((a) => [a.panelId, a])),
        ts: b.ts,
      });
    },
  })
);

export { combinedActivityRows } from "@shared/task-activity-sources.ts";

export type ActivityCounts = ActivityOverviewCounts;

/**
 * 本窗活动总览计数。与标题栏 `agentIndexCounts` 有意分叉：
 * - 本窗范围；running 不计 launch 无 status
 * - needsYou 含 waiting + error（+ 列表中的 task blocked/failed）
 * - inProgress = combinedActivityRows 行数
 * 无 taskRuns 时按空 snapshot 计（仅 agent 侧有效）。
 * 有 TaskRuns 时务必传 `windowId`，否则 background task 可能跨窗泄漏。
 */
export function activityCounts(
  activities: Record<string, ForegroundActivity>,
  taskRuns?: TaskRunsSnapshot,
  options?: { windowId?: string }
): ActivityCounts {
  return activityOverviewCounts(
    activities,
    taskRuns ?? emptyTaskRunsSnapshot(),
    options
  );
}
