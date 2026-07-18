import type { QuitActivitySummary } from "@shared/contracts/app-quit.ts";
import type {
  ActivityStatus,
  ForegroundActivity,
} from "@shared/contracts/foreground-activity.ts";
import type { TaskRunsSnapshot } from "@shared/contracts/tasks.ts";

function isActiveAgentStatus(status: ActivityStatus | undefined): boolean {
  return status === "processing" || status === "tool" || status === "waiting";
}

/**
 * 关闭 terminal panel 时仅提示“仍在推进/等待确认”的 agent。
 * ready（等待输入）、shell、task、idle 都直接关闭，不弹确认。
 */
function summarizeActivity(
  activity: ForegroundActivity
): QuitActivitySummary | null {
  if (activity.kind !== "agent") {
    return null;
  }
  if (!isActiveAgentStatus(activity.status)) {
    return null;
  }
  return {
    kind: "agent",
    label: activity.agentId,
    panelId: activity.panelId,
    windowId: activity.windowId,
  };
}

/**
 * 关闭某 terminal panel 前需要提示的危险活动。
 * 仅 agent 的 processing/tool/waiting；shell/task/ready 不拦截关闭。
 * `taskRuns` 保留以兼容调用方签名，本轮不参与关闭确认。
 */
export function dangerousActivitySummariesForPanel(
  panelId: string,
  activities: Record<string, ForegroundActivity>,
  _taskRuns: TaskRunsSnapshot
): QuitActivitySummary[] {
  const activity = activities[panelId];
  if (!activity) {
    return [];
  }
  const summary = summarizeActivity(activity);
  return summary ? [summary] : [];
}
