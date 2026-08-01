import type { TaskRunControlEntry } from "@shared/contracts/tasks.ts";
import { describe, expect, it, vi } from "vitest";
import {
  clearTaskRunFinishedNotificationsForTests,
  notifyTaskRunFinishedIfNeeded,
} from "@/panel-kits/terminal/notify-task-run-finished.ts";

const reportMock = vi.fn();

function run(
  status: TaskRunControlEntry["status"],
  options: { mode?: TaskRunControlEntry["mode"]; runId?: string } = {}
): TaskRunControlEntry {
  return {
    mode: options.mode ?? "background",
    nodes: {
      test: {
        label: "Test suite",
        panelId: "terminal-task",
        status,
        taskId: "test",
      },
    },
    projectRootPath: "/repo",
    rootTaskId: "test",
    runId: options.runId ?? "run-1",
    startedAt: 1000,
    status,
    updatedAt: 43_000,
  };
}

describe("notifyTaskRunFinishedIfNeeded", () => {
  it("never reports (task finish notifications retired)", () => {
    (window as { pier?: unknown }).pier = {
      notificationCenter: { report: reportMock },
    };
    clearTaskRunFinishedNotificationsForTests();

    notifyTaskRunFinishedIfNeeded(run("succeeded"));
    notifyTaskRunFinishedIfNeeded(run("failed", { runId: "fail" }));
    notifyTaskRunFinishedIfNeeded(
      run("succeeded", { mode: "terminal-tab", runId: "fg" })
    );

    expect(reportMock).not.toHaveBeenCalled();
    (window as { pier?: unknown }).pier = undefined;
  });
});
