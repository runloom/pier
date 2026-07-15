import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import type { TaskRunsSnapshot } from "@shared/contracts/tasks.ts";
import { describe, expect, it } from "vitest";
import { dangerousActivitySummariesForPanel } from "@/lib/workspace/panel-close-activity.ts";

function emptyTaskRuns(): TaskRunsSnapshot {
  return { runs: {}, version: 0 };
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

  it("summarizes a running agent on the panel", () => {
    const activities: Record<string, ForegroundActivity> = {
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
        activities,
        emptyTaskRuns()
      )
    ).toEqual([
      {
        kind: "agent",
        label: "codex",
        panelId: "terminal-1",
        windowId: "win-1",
      },
    ]);
  });

  it("includes background tasks bound to the origin panel", () => {
    const activities: Record<string, ForegroundActivity> = {};
    const taskRuns: TaskRunsSnapshot = {
      runs: {
        "run-1": {
          mode: "background",
          nodes: {
            build: {
              label: "build",
              status: "running",
              taskId: "build",
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
    expect(
      dangerousActivitySummariesForPanel("terminal-1", activities, taskRuns)
    ).toEqual([
      {
        kind: "task",
        label: "build",
        panelId: "terminal-1",
        windowId: "win-1",
      },
    ]);
  });
});
