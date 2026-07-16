import type { QuitActivitySummary } from "@shared/contracts/app-quit.ts";
import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import type { AppQuitConfirmationMode } from "@shared/contracts/preferences.ts";
import type { TaskRunsSnapshot } from "@shared/contracts/tasks.ts";
import { quitSummariesFromActiveTaskRuns } from "@shared/task-activity-sources.ts";

export type { QuitActivitySummary } from "@shared/contracts/app-quit.ts";

export function isDangerousQuitActivity(activity: ForegroundActivity): boolean {
  switch (activity.kind) {
    case "agent":
    case "shell":
      return true;
    case "task":
      return true;
    case "idle":
      return false;
    default: {
      const exhaustive: never = activity;
      return exhaustive;
    }
  }
}

export function summarizeQuitActivity(
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

export function summarizeDangerousQuitActivities(
  activities: readonly ForegroundActivity[],
  taskRuns?: TaskRunsSnapshot
): QuitActivitySummary[] {
  const fromForeground = activities.flatMap((activity) => {
    const summary = summarizeQuitActivity(activity);
    return summary ? [summary] : [];
  });
  if (!taskRuns) {
    return fromForeground;
  }
  return [
    ...fromForeground,
    ...quitSummariesFromActiveTaskRuns(taskRuns, activities),
  ];
}

export function shouldConfirmBeforeQuit(
  mode: AppQuitConfirmationMode,
  dangerousActivityCount: number
): boolean {
  switch (mode) {
    case "always":
      return true;
    case "hasActivity":
      return dangerousActivityCount > 0;
    case "never":
      return false;
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}
