import type { QuitActivitySummary } from "@shared/contracts/app-quit.ts";
import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import type { TaskRunsSnapshot } from "@shared/contracts/tasks.ts";
import { activeTaskActivitiesNotInForeground } from "@shared/task-activity-sources.ts";

function summaryKey(summary: QuitActivitySummary): string {
  return `${summary.kind}\0${summary.windowId}\0${summary.panelId}\0${summary.label}`;
}

function summarizeActivity(
  activity: ForegroundActivity
): QuitActivitySummary | null {
  switch (activity.kind) {
    case "shell": {
      const commandLine = activity.commandLine?.trim() ?? "";
      return {
        kind: "shell",
        label: commandLine || "Shell command",
        panelId: activity.panelId,
        ...(commandLine ? { commandLine } : {}),
        windowId: activity.windowId,
      };
    }
    case "agent":
      return {
        kind: "agent",
        label: activity.agentId,
        panelId: activity.panelId,
        windowId: activity.windowId,
      };
    case "task":
      return {
        kind: "task",
        label: activity.label,
        panelId: activity.panelId,
        windowId: activity.windowId,
      };
    case "idle":
      return null;
    default: {
      const exhaustive: never = activity;
      return exhaustive;
    }
  }
}

/**
 * 关闭某 terminal panel 前需要提示的危险活动（对齐 quit：agent / shell / task）。
 * background task 的 panelId 已归一到 originPanelId（见 task-activity-sources）。
 */
export function dangerousActivitySummariesForPanel(
  panelId: string,
  activities: Record<string, ForegroundActivity>,
  taskRuns: TaskRunsSnapshot
): QuitActivitySummary[] {
  const summaries: QuitActivitySummary[] = [];
  const seen = new Set<string>();
  const push = (summary: QuitActivitySummary) => {
    const key = summaryKey(summary);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    summaries.push(summary);
  };

  const activity = activities[panelId];
  if (activity) {
    const summary = summarizeActivity(activity);
    if (summary) {
      push(summary);
    }
  }

  const foregroundRows = Object.values(activities).filter(
    (candidate) => candidate.kind !== "idle"
  );
  for (const task of activeTaskActivitiesNotInForeground(
    taskRuns,
    foregroundRows
  )) {
    if (task.panelId === panelId) {
      push({
        kind: "task",
        label: task.label,
        panelId: task.panelId,
        windowId: task.windowId,
      });
    }
  }

  return summaries;
}
