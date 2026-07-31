import type { TaskRunsSnapshot } from "@shared/contracts/tasks.ts";
import {
  committedTaskOutputRunId,
  preferredActiveBackgroundRunForOutput,
  preferredBackgroundRunForOutputRebind,
} from "@shared/contracts/tasks.ts";
import { describe, expect, it } from "vitest";

function backgroundRun(
  runId: string,
  status: "pending" | "running" | "succeeded" = "running"
) {
  return {
    mode: "background" as const,
    nodes: {
      test: {
        label: "Test",
        panelId: "task-output-panel",
        status,
        taskId: "test",
      },
    },
    projectRootPath: "/repo",
    rootTaskId: "test",
    runId,
    startedAt: 1,
    status,
    updatedAt: status === "running" ? 2 : 10,
  };
}

function terminalRun(runId: string) {
  return {
    mode: "terminal-tab" as const,
    nodes: {
      test: {
        label: "Test",
        panelId: "terminal-task",
        status: "running" as const,
        taskId: "test",
      },
    },
    projectRootPath: "/repo",
    rootTaskId: "test",
    runId,
    startedAt: 5,
    status: "running" as const,
    updatedAt: 6,
  };
}

const outputV2 = {
  contextId: "ctx-repo",
  generation: 0,
  label: "Test",
  projectRootPath: "/repo",
  selectedRunId: "run-old",
  taskId: "test",
  version: 2 as const,
};

describe("task output binding gold standard", () => {
  it("committed binding reads params only", () => {
    expect(committedTaskOutputRunId(outputV2)).toBe("run-old");
  });

  it("prefers only active background runs", () => {
    const snapshot: TaskRunsSnapshot = {
      runs: {
        "run-bg": backgroundRun("run-bg"),
        "run-tab": terminalRun("run-tab"),
      },
      version: 1,
    };
    expect(
      preferredActiveBackgroundRunForOutput(snapshot, {
        projectRootPath: "/repo",
        taskId: "test",
      })?.runId
    ).toBe("run-bg");
  });

  it("does not rebind output to a terminal-tab run", () => {
    const snapshot: TaskRunsSnapshot = {
      runs: {
        "run-old": backgroundRun("run-old", "succeeded"),
        "run-tab": terminalRun("run-tab"),
      },
      version: 2,
    };
    expect(
      preferredBackgroundRunForOutputRebind(outputV2, snapshot)
    ).toBeUndefined();
  });

  it("rebinds when a newer background run supersedes a finished binding", () => {
    const snapshot: TaskRunsSnapshot = {
      runs: {
        "run-new": backgroundRun("run-new"),
        "run-old": backgroundRun("run-old", "succeeded"),
      },
      version: 3,
    };
    expect(
      preferredBackgroundRunForOutputRebind(outputV2, snapshot)?.runId
    ).toBe("run-new");
  });
});
