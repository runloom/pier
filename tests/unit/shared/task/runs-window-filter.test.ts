import type {
  TaskRunControlEntry,
  TaskRunsSnapshot,
} from "@shared/contracts/tasks.ts";
import { filterTaskRunsSnapshotForWindow } from "@shared/task-runs-window-filter.ts";
import { describe, expect, it } from "vitest";

function run(runId: string, ownerWindowId?: string): TaskRunControlEntry {
  return {
    mode: "background",
    nodes: {
      t: {
        label: "t",
        panelId: `background-task:${runId}:t`,
        status: "running",
        taskId: "t",
      },
    },
    originPanelId: "terminal-1",
    ...(ownerWindowId ? { ownerWindowId } : {}),
    projectRootPath: "/repo",
    rootTaskId: "t",
    runId,
    startedAt: 1,
    status: "running",
    updatedAt: 2,
  };
}

describe("filterTaskRunsSnapshotForWindow", () => {
  it("keeps only runs owned by the target window", () => {
    const snapshot: TaskRunsSnapshot = {
      runs: {
        a: run("a", "main"),
        b: run("b", "other"),
      },
      version: 3,
    };
    expect(
      Object.keys(filterTaskRunsSnapshotForWindow(snapshot, "main").runs)
    ).toEqual(["a"]);
    expect(filterTaskRunsSnapshotForWindow(snapshot, "main").version).toBe(3);
  });

  it("drops runs with missing ownerWindowId (would make RC invisible)", () => {
    const snapshot: TaskRunsSnapshot = {
      runs: {
        orphan: run("orphan"),
        owned: run("owned", "main"),
      },
      version: 1,
    };
    expect(
      Object.keys(filterTaskRunsSnapshotForWindow(snapshot, "main").runs)
    ).toEqual(["owned"]);
  });

  it("returns empty when windowId is null", () => {
    const snapshot: TaskRunsSnapshot = {
      runs: { a: run("a", "main") },
      version: 1,
    };
    expect(filterTaskRunsSnapshotForWindow(snapshot, null).runs).toEqual({});
  });
});
