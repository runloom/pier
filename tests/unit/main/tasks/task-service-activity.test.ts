import { createTaskService } from "@main/services/tasks/task-service.ts";
import type { TaskLaunchPlan } from "@shared/contracts/tasks.ts";
import { describe, expect, it, vi } from "vitest";

/**
 * 回归覆盖：`task-service.cancelRun` 引入 `onTaskActivity.onFinished` fire 后,
 * 若不按 `node.status` 过滤会把已 succeeded 的 activity 覆盖为 cancelled。
 *
 * 这是 e40d01d8 修复的行为。守卫防退化：多 task DAG 部分完成后 restart 不再让
 * 已 success 的 tab 被覆盖为 cancelled（activity 终态常驻, 覆盖即永久谎报）。
 */
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
  it("skips onFinished for nodes that stay in a non-cancelled terminal state", async () => {
    const onLaunched = vi.fn();
    const onFinished = vi.fn();
    const service = createTaskService({
      onTaskActivity: { onFinished, onLaunched },
      readRecentState: async () => ({ entries: [], version: 1 }),
      writeRecentState: async () => undefined,
    });

    // build → test (parallel dependency). Coordinator schedules from rootTaskId
    // 递归拉起依赖，两个节点都会开启 terminal，第二个依赖 build 完成后 schedule。
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
    // build 先开（test 因依赖 waiting）；等 build 完成后 test 才 schedule。
    expect(onLaunched).toHaveBeenCalledTimes(1);
    expect(onLaunched).toHaveBeenCalledWith(
      "panel-build",
      "main",
      expect.objectContaining({ taskId: "build" })
    );

    // build 完成 → coordinator 记 status=succeeded；schedule test；activity fire success。
    await service.completePanel("panel-build", 0, "main");
    expect(onFinished).toHaveBeenNthCalledWith(1, "panel-build", {
      exitCode: 0,
      status: "success",
    });
    // build 完成时 coordinator 里 schedule → 会开 test。
    expect(onLaunched).toHaveBeenCalledTimes(2);

    // cancelRun 取消整 run。coordinator 只把 test（running）→ cancelled；build
    // 保持 succeeded。**回归守卫**：build 不能收 status=cancelled。
    onFinished.mockClear();
    service.cancelRun(opened.runId);

    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledWith("panel-test", {
      status: "cancelled",
    });
    expect(onFinished).not.toHaveBeenCalledWith(
      "panel-build",
      expect.anything()
    );
  });
});
