import type {
  ForegroundActivity,
  ForegroundActivityBroadcast,
} from "@shared/contracts/foreground-activity.ts";
import {
  activeTaskRunCount,
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

export interface ActivityCounts {
  running: number;
  waiting: number;
}

/**
 * 本窗 FA 计数（工作台 overview 等）。与标题栏 `agentIndexCounts` 有意分叉：
 * 不计 launch、waiting 不含 error；勿混用两套桶。
 */
export function activityCounts(
  activities: Record<string, ForegroundActivity>,
  taskRuns?: TaskRunsSnapshot
): ActivityCounts {
  let running = taskRuns ? activeTaskRunCount(taskRuns) : 0;
  let waiting = 0;
  for (const a of Object.values(activities)) {
    if (a.kind === "agent") {
      if (a.status === "processing" || a.status === "tool") {
        running += 1;
      } else if (a.status === "waiting") {
        waiting += 1;
      }
    }
  }
  return { running, waiting };
}
