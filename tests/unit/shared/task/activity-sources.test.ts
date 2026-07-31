import type {
  ForegroundActivity,
  TaskActivity,
} from "@shared/contracts/foreground-activity.ts";
import {
  activeTaskActivitiesNotInForeground,
  activityKindCounts,
  combinedActivityRows,
  quitSummariesFromActiveTaskRuns,
  revealPanelIdForTaskActivity,
  taskNodeStatusForActivity,
} from "@shared/task-activity-sources.ts";
import { describe, expect, it } from "vitest";

const BASE_ACTIVITY = {
  panelId: "panel-1",
  windowId: "main",
  spawnedAt: 1,
  updatedAt: 2,
} as const;

function taskActivity(overrides: Partial<TaskActivity> = {}): TaskActivity {
  return {
    kind: "task",
    label: "build",
    runId: "run-tab",
    taskId: "build",
    ...BASE_ACTIVITY,
    ...overrides,
  };
}

describe("task activity sources", () => {
  it("reads node-level status for activity dots", () => {
    const snapshot = {
      runs: {
        "run-1": {
          mode: "terminal-tab" as const,
          nodes: {
            build: {
              label: "build",
              panelId: "panel-1",
              status: "stopping" as const,
              taskId: "build",
              windowId: "main",
            },
          },
          projectRootPath: "/repo",
          rootTaskId: "build",
          runId: "run-1",
          startedAt: 1,
          status: "running" as const,
          updatedAt: 3,
        },
      },
      version: 1,
    };

    expect(taskNodeStatusForActivity(snapshot, "run-1", "build")).toBe(
      "stopping"
    );
  });

  it("adds active background runs missing from foreground activity", () => {
    const taskRuns = {
      runs: {
        "run-bg": {
          mode: "background" as const,
          nodes: {
            test: {
              label: "test",
              panelId: "background-task:run-bg:test",
              status: "running" as const,
              taskId: "package-script:test",
            },
          },
          originPanelId: "terminal-1",
          ownerWindowId: "main",
          projectRootPath: "/repo",
          rootTaskId: "package-script:test",
          runId: "run-bg",
          startedAt: 1,
          status: "running" as const,
          updatedAt: 2,
        },
      },
      version: 1,
    };

    const extra = activeTaskActivitiesNotInForeground(taskRuns, []);
    expect(extra).toEqual([
      expect.objectContaining({
        kind: "task",
        label: "test",
        panelId: "terminal-1",
        runId: "run-bg",
        windowId: "main",
      }),
    ]);
    expect(quitSummariesFromActiveTaskRuns(taskRuns, [])).toEqual([
      {
        kind: "task",
        label: "test",
        panelId: "terminal-1",
        windowId: "main",
      },
    ]);
  });

  it("merges foreground rows with uncovered background tasks", () => {
    const activities: Record<string, ForegroundActivity> = {
      "panel-agent": {
        kind: "agent",
        agentId: "codex",
        source: "hook",
        subagentCount: 0,
        panelId: "panel-agent",
        windowId: "main",
        spawnedAt: 1,
        updatedAt: 5,
        status: "processing",
      },
    };
    const taskRuns = {
      runs: {
        "run-bg": {
          mode: "background" as const,
          nodes: {
            lint: {
              label: "lint",
              panelId: "background-task:run-bg:lint",
              status: "running" as const,
              taskId: "package-script:lint",
            },
          },
          originPanelId: "terminal-1",
          ownerWindowId: "main",
          projectRootPath: "/repo",
          rootTaskId: "package-script:lint",
          runId: "run-bg",
          startedAt: 1,
          status: "running" as const,
          updatedAt: 4,
        },
      },
      version: 1,
    };

    const rows = combinedActivityRows(activities, taskRuns);
    expect(rows.map((row) => row.kind)).toEqual(["agent", "task"]);
    expect(activityKindCounts(activities, taskRuns).get("task")).toBe(1);
    expect(activityKindCounts(activities, taskRuns).get("agent")).toBe(1);
  });

  it("reveals origin panel for background task drill-down", () => {
    const activity = taskActivity({
      panelId: "terminal-1",
      runId: "run-bg",
      taskId: "package-script:test",
    });
    const taskRuns = {
      runs: {
        "run-bg": {
          mode: "background" as const,
          nodes: {
            test: {
              label: "test",
              panelId: "background-task:run-bg:test",
              status: "running" as const,
              taskId: "package-script:test",
            },
          },
          originPanelId: "terminal-1",
          ownerWindowId: "main",
          projectRootPath: "/repo",
          rootTaskId: "package-script:test",
          runId: "run-bg",
          startedAt: 1,
          status: "running" as const,
          updatedAt: 2,
        },
      },
      version: 1,
    };

    expect(revealPanelIdForTaskActivity(activity, taskRuns)).toBe("terminal-1");
  });

  it("skips foreground-covered terminal-tab tasks", () => {
    const taskRuns = {
      runs: {
        "run-tab": {
          mode: "terminal-tab" as const,
          nodes: {
            build: {
              label: "build",
              panelId: "panel-1",
              status: "running" as const,
              taskId: "build",
              windowId: "main",
            },
          },
          ownerWindowId: "main",
          projectRootPath: "/repo",
          rootTaskId: "build",
          runId: "run-tab",
          startedAt: 1,
          status: "running" as const,
          updatedAt: 2,
        },
      },
      version: 1,
    };

    expect(
      activeTaskActivitiesNotInForeground(taskRuns, [taskActivity()])
    ).toEqual([]);
  });
});
