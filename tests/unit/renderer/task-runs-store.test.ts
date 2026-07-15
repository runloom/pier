import type { TaskRunsSnapshot } from "@shared/contracts/tasks.ts";
import { describe, expect, it } from "vitest";
import {
  taskRunsForPanel,
  taskRunsOwnedByPanel,
} from "@/stores/task-runs.store.ts";

function backgroundRun(
  originPanelId: string
): TaskRunsSnapshot["runs"][string] {
  return {
    mode: "background",
    nodes: {
      dev: {
        label: "dev",
        panelId: "background-task:run-bg:dev",
        status: "running",
        taskId: "dev",
      },
    },
    originPanelId,
    projectRootPath: "/repo",
    rootTaskId: "dev",
    runId: "run-bg",
    startedAt: 1,
    status: "running",
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
