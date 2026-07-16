import { createTaskService } from "@main/services/tasks/task-service.ts";
import type { TaskLaunchPlan } from "@shared/contracts/tasks.ts";
import { describe, expect, it, vi } from "vitest";

function makeLaunch(
  taskId: string,
  overrides: Partial<TaskLaunchPlan> = {}
): TaskLaunchPlan {
  return {
    command: `${taskId}; code=$?; exit "$code"`,
    cwd: "/repo",
    focus: true,
    label: taskId,
    presentation: {},
    projectRootPath: "/repo",
    rawCommand: taskId,
    source: "history",
    tab: { title: taskId },
    taskId,
    ...overrides,
  };
}

describe("task-service cancelRun onTaskActivity gating", () => {
  it("clears occupation only for nodes that became cancelled", async () => {
    const onLaunched = vi.fn();
    const onCleared = vi.fn();
    const service = createTaskService({
      onTaskActivity: { onCleared, onLaunched },
      readRecentState: async () => ({ entries: [], version: 1 }),
      writeRecentState: async () => undefined,
    });

    const opened = await service.startRun({
      launches: [
        makeLaunch("build"),
        makeLaunch("test", {
          dependsOn: ["build"],
          dependsOrder: "parallel",
        }),
      ],
      openTerminal: (launch) =>
        Promise.resolve({
          panelId: `panel-${launch.taskId}`,
          windowId: "main",
        }),
      projectRootPath: "/repo",
      rootTaskId: "test",
    });
    expect(onLaunched).toHaveBeenCalledTimes(1);

    await service.completePanel("panel-build", 0, "main");
    expect(onCleared).toHaveBeenNthCalledWith(1, "panel-build", "main", {
      runId: opened.runId,
    });
    expect(onLaunched).toHaveBeenCalledTimes(2);

    onCleared.mockClear();
    service.cancelRun(opened.runId);

    expect(onCleared).toHaveBeenCalledTimes(1);
    expect(onCleared).toHaveBeenCalledWith("panel-test", "main", {
      runId: opened.runId,
    });
    expect(onCleared).not.toHaveBeenCalledWith(
      "panel-build",
      expect.anything()
    );
  });
});
