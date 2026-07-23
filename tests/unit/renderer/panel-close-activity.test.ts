import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import type { TaskRunsSnapshot } from "@shared/contracts/tasks.ts";
import { describe, expect, it } from "vitest";
import {
  activeTaskRunsToStopForPanel,
  dangerousActivitySummariesForPanel,
} from "@/lib/workspace/panel-close-activity.ts";

function emptyTaskRuns(): TaskRunsSnapshot {
  return { runs: {}, version: 0 };
}

function runningTaskRuns(): TaskRunsSnapshot {
  return {
    runs: {
      "run-1": {
        mode: "background",
        nodes: {
          build: {
            label: "build",
            status: "running",
            taskId: "build",
            windowId: "win-1",
          },
        },
        originPanelId: "terminal-1",
        ownerWindowId: "win-1",
        projectRootPath: "/repo",
        rootTaskId: "build",
        runId: "run-1",
        startedAt: 1,
        status: "running",
        updatedAt: 2,
      },
    },
    version: 1,
  };
}

describe("dangerousActivitySummariesForPanel", () => {
  it("returns empty when the panel is idle or missing", () => {
    const activities: Record<string, ForegroundActivity> = {
      "terminal-1": {
        kind: "idle",
        panelId: "terminal-1",
        spawnedAt: 1,
        updatedAt: 1,
        windowId: "win-1",
      },
    };
    expect(
      dangerousActivitySummariesForPanel(
        "terminal-1",
        activities,
        emptyTaskRuns()
      )
    ).toEqual([]);
    expect(
      dangerousActivitySummariesForPanel("missing", activities, emptyTaskRuns())
    ).toEqual([]);
  });

  it("summarizes only active agent statuses", () => {
    const processing: Record<string, ForegroundActivity> = {
      "terminal-1": {
        agentId: "codex",
        kind: "agent",
        panelId: "terminal-1",
        source: "hook",
        spawnedAt: 1,
        status: "processing",
        subagentCount: 0,
        updatedAt: 2,
        windowId: "win-1",
      },
    };
    expect(
      dangerousActivitySummariesForPanel(
        "terminal-1",
        processing,
        emptyTaskRuns()
      )
    ).toEqual([
      {
        kind: "agent",
        label: "Codex",
        panelId: "terminal-1",
        windowId: "win-1",
      },
    ]);

    const ready: Record<string, ForegroundActivity> = {
      "terminal-1": {
        agentId: "codex",
        kind: "agent",
        panelId: "terminal-1",
        source: "hook",
        spawnedAt: 1,
        status: "ready",
        subagentCount: 0,
        updatedAt: 2,
        windowId: "win-1",
      },
    };
    expect(
      dangerousActivitySummariesForPanel("terminal-1", ready, emptyTaskRuns())
    ).toEqual([]);
  });

  it("ignores shell activity on panel close", () => {
    const activities: Record<string, ForegroundActivity> = {
      "terminal-1": {
        commandLine: "npm test",
        kind: "shell",
        panelId: "terminal-1",
        spawnedAt: 1,
        updatedAt: 2,
        windowId: "win-1",
      },
    };
    expect(
      dangerousActivitySummariesForPanel(
        "terminal-1",
        activities,
        emptyTaskRuns()
      )
    ).toEqual([]);
  });

  it("includes active task runs related to the panel", () => {
    const taskRuns = runningTaskRuns();
    expect(
      dangerousActivitySummariesForPanel("terminal-1", {}, taskRuns)
    ).toEqual([
      {
        kind: "task",
        label: "build",
        panelId: "terminal-1",
        windowId: "win-1",
      },
    ]);
    expect(activeTaskRunsToStopForPanel("terminal-1", taskRuns)).toEqual([
      taskRuns.runs["run-1"],
    ]);
    expect(activeTaskRunsToStopForPanel("other", taskRuns)).toEqual([]);
  });

  it("dedupes foreground task activity with the same runId", () => {
    const activities: Record<string, ForegroundActivity> = {
      "terminal-1": {
        kind: "task",
        label: "dev",
        panelId: "terminal-1",
        runId: "run-1",
        spawnedAt: 1,
        taskId: "build",
        updatedAt: 2,
        windowId: "win-1",
      },
    };
    expect(
      dangerousActivitySummariesForPanel(
        "terminal-1",
        activities,
        runningTaskRuns()
      )
    ).toEqual([
      {
        kind: "task",
        label: "dev",
        panelId: "terminal-1",
        windowId: "win-1",
      },
    ]);
  });
});
