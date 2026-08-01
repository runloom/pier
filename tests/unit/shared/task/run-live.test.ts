import {
  activeTaskRunCount,
  deriveBackgroundSnapshot,
  isPanelTaskLive,
  taskRunTabState,
} from "@shared/contracts/tasks.ts";
import { describe, expect, it } from "vitest";

describe("task run single-source helpers", () => {
  it("maps TaskRunNodeStatus to tab state", () => {
    expect(taskRunTabState("running")).toMatchObject({ status: "running" });
    expect(taskRunTabState("failed", 2)).toMatchObject({
      label: "Failed 2",
      status: "failed",
    });
  });

  it("detects live panel association from TaskRuns only", () => {
    const snapshot = {
      runs: {
        "run-1": {
          mode: "terminal-tab" as const,
          nodes: {
            build: {
              label: "build",
              panelId: "panel-1",
              status: "running" as const,
              taskId: "build",
            },
          },
          projectRootPath: "/repo",
          rootTaskId: "build",
          runId: "run-1",
          ownerWindowId: "main",
          startedAt: 1,
          status: "running" as const,
          updatedAt: 2,
        },
      },
      version: 1,
    };

    expect(isPanelTaskLive(snapshot, "panel-1", "main")).toBe(true);
    expect(isPanelTaskLive(snapshot, "panel-1", "other")).toBe(false);
    expect(isPanelTaskLive(snapshot, "panel-2")).toBe(false);
  });

  it("does not treat background origin panel as live PTY host", () => {
    const snapshot = {
      runs: {
        "run-bg": {
          mode: "background" as const,
          nodes: {
            test: {
              label: "test",
              panelId: "background-task:run-bg:test",
              status: "running" as const,
              taskId: "test",
            },
          },
          originPanelId: "origin-1",
          ownerWindowId: "main",
          projectRootPath: "/repo",
          rootTaskId: "test",
          runId: "run-bg",
          startedAt: 1,
          status: "running" as const,
          updatedAt: 2,
        },
      },
      version: 1,
    };

    expect(isPanelTaskLive(snapshot, "origin-1", "main")).toBe(false);
    expect(
      isPanelTaskLive(snapshot, "background-task:run-bg:test", "main")
    ).toBe(true);
  });

  it("filters active task run count by window", () => {
    const snapshot = {
      runs: {
        a: {
          mode: "terminal-tab" as const,
          nodes: {
            one: {
              label: "one",
              panelId: "p1",
              status: "running" as const,
              taskId: "one",
            },
          },
          ownerWindowId: "main",
          projectRootPath: "/repo",
          rootTaskId: "one",
          runId: "a",
          startedAt: 1,
          status: "running" as const,
          updatedAt: 1,
        },
        b: {
          mode: "terminal-tab" as const,
          nodes: {
            two: {
              label: "two",
              panelId: "p2",
              status: "running" as const,
              taskId: "two",
            },
          },
          ownerWindowId: "other",
          projectRootPath: "/repo",
          rootTaskId: "two",
          runId: "b",
          startedAt: 1,
          status: "running" as const,
          updatedAt: 1,
        },
      },
      version: 1,
    };

    expect(activeTaskRunCount(snapshot)).toBe(2);
    expect(activeTaskRunCount(snapshot, "main")).toBe(1);
  });

  it("derives background snapshot from TaskRuns", () => {
    const snapshot = {
      runs: {
        "run-bg": {
          mode: "background" as const,
          nodes: {
            test: {
              label: "test",
              panelId: "background-task:run-bg:test",
              status: "succeeded" as const,
              taskId: "test",
              exitCode: 0,
            },
          },
          originPanelId: "origin-1",
          projectRootPath: "/repo",
          rootTaskId: "test",
          runId: "run-bg",
          startedAt: 1,
          status: "succeeded" as const,
          updatedAt: 3,
        },
      },
      version: 4,
    };

    expect(deriveBackgroundSnapshot(snapshot)).toEqual({
      version: 4,
      runs: {
        "/repo": {
          test: expect.objectContaining({
            runId: "run-bg",
            status: "succeeded",
            finishedAt: 3,
          }),
        },
      },
    });
  });
});
