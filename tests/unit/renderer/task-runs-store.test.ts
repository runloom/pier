import type { TaskRunNodeStatus } from "@shared/contracts/task-run-snapshot.ts";
import type { TaskRunsSnapshot } from "@shared/contracts/tasks.ts";
import { describe, expect, it } from "vitest";
import {
  panelHasActiveTaskRun,
  taskRunsForPanel,
  taskRunsOwnedByPanel,
} from "@/stores/task-runs.store.ts";

function backgroundRun(
  originPanelId: string,
  status: TaskRunNodeStatus = "running",
  runId = "run-bg"
): TaskRunsSnapshot["runs"][string] {
  return {
    mode: "background",
    nodes: {
      dev: {
        label: "dev",
        panelId: `background-task:${runId}:dev`,
        status,
        taskId: "dev",
      },
    },
    originPanelId,
    projectRootPath: "/repo",
    rootTaskId: "dev",
    runId,
    startedAt: 1,
    status,
    updatedAt: 2,
  };
}

function ownedForegroundRun(
  panelId: string,
  status: TaskRunNodeStatus,
  runId = "run-fg"
): TaskRunsSnapshot["runs"][string] {
  return {
    mode: "terminal-tab",
    nodes: {
      dev: {
        label: "dev",
        panelId,
        status,
        taskId: "dev",
      },
    },
    projectRootPath: "/repo",
    rootTaskId: "dev",
    runId,
    startedAt: 1,
    status,
    updatedAt: 2,
  };
}

describe("taskRunsForPanel vs taskRunsOwnedByPanel", () => {
  const snapshot: TaskRunsSnapshot = {
    runs: { "run-bg": backgroundRun("origin-shell") },
    version: 1,
  };

  it("includes background origin in panel scope for runtime control", () => {
    expect(taskRunsForPanel(snapshot, "origin-shell")).toHaveLength(1);
  });

  it("excludes background origin from owned runs used by tab chrome", () => {
    expect(taskRunsOwnedByPanel(snapshot, "origin-shell")).toHaveLength(0);
    expect(
      taskRunsOwnedByPanel(snapshot, "background-task:run-bg:dev")
    ).toHaveLength(1);
  });
});

describe("panelHasActiveTaskRun", () => {
  it("is true for owned foreground running runs", () => {
    const snapshot: TaskRunsSnapshot = {
      runs: {
        "run-fg": ownedForegroundRun("task-panel", "running"),
      },
      version: 1,
    };
    expect(panelHasActiveTaskRun(snapshot, "task-panel")).toBe(true);
  });

  it("is true for origin-only background running runs", () => {
    const snapshot: TaskRunsSnapshot = {
      runs: { "run-bg": backgroundRun("origin-shell", "running") },
      version: 1,
    };
    expect(panelHasActiveTaskRun(snapshot, "origin-shell")).toBe(true);
    expect(panelHasActiveTaskRun(snapshot, "background-task:run-bg:dev")).toBe(
      true
    );
  });

  it("is true when any of multiple runs is still active", () => {
    const snapshot: TaskRunsSnapshot = {
      runs: {
        "run-failed": ownedForegroundRun("shell", "failed", "run-failed"),
        "run-active": backgroundRun("shell", "running", "run-active"),
      },
      version: 1,
    };
    expect(panelHasActiveTaskRun(snapshot, "shell")).toBe(true);
  });

  it("is false when all related runs are terminal", () => {
    const snapshot: TaskRunsSnapshot = {
      runs: {
        a: ownedForegroundRun("shell", "succeeded", "a"),
        b: backgroundRun("shell", "failed", "b"),
        c: backgroundRun("shell", "cancelled", "c"),
        d: ownedForegroundRun("shell", "blocked", "d"),
      },
      version: 1,
    };
    expect(panelHasActiveTaskRun(snapshot, "shell")).toBe(false);
  });

  it("is false for empty snapshot or unrelated panelId", () => {
    expect(panelHasActiveTaskRun({ runs: {}, version: 0 }, "any")).toBe(false);
    const snapshot: TaskRunsSnapshot = {
      runs: { "run-fg": ownedForegroundRun("task-panel", "running") },
      version: 1,
    };
    expect(panelHasActiveTaskRun(snapshot, "other-panel")).toBe(false);
  });

  it.each([
    "pending",
    "running",
    "stopping",
  ] as const)("is true for %s status", (status) => {
    const snapshot: TaskRunsSnapshot = {
      runs: {
        "run-fg": ownedForegroundRun("task-panel", status),
      },
      version: 1,
    };
    expect(panelHasActiveTaskRun(snapshot, "task-panel")).toBe(true);
  });
});
