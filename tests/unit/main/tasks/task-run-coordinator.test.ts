import {
  createTaskRunCoordinator,
  type TaskRunLaunchPlan,
} from "@main/services/tasks/task-run-coordinator.ts";
import { describe, expect, it } from "vitest";

function launch(
  taskId: string,
  label: string,
  overrides: Partial<TaskRunLaunchPlan> = {}
): TaskRunLaunchPlan {
  return {
    command: `${label}; code=$?; exit "$code"`,
    cwd: "/repo",
    focus: true,
    label,
    presentation: {},
    projectRootPath: "/repo",
    rawCommand: label,
    source: "history",
    tab: { title: label },
    taskId,
    ...overrides,
  };
}

describe("task run coordinator", () => {
  it("rejects a completion carrying the run id replaced in the same panel", async () => {
    const coordinator = createTaskRunCoordinator({
      openTerminal: async () => ({
        panelId: "terminal-reused",
        windowId: "window-main",
      }),
    });
    const first = await coordinator.start({
      launches: [launch("test", "test")],
      mode: "terminal-tab",
      projectRootPath: "/repo",
      rootTaskId: "test",
    });
    const second = await coordinator.start({
      launches: [launch("test", "test")],
      mode: "terminal-tab",
      projectRootPath: "/repo",
      rootTaskId: "test",
    });

    await expect(
      coordinator.completePanel(
        "terminal-reused",
        143,
        "window-main",
        first.runId
      )
    ).resolves.toBeNull();
    expect(coordinator.status(second.runId)?.status).toBe("running");
  });

  it("publishes a versioned control snapshot with panel ownership", async () => {
    const snapshots: unknown[] = [];
    const coordinator = createTaskRunCoordinator({
      onChanged: (snapshot) => snapshots.push(snapshot),
      openTerminal: async () => ({
        panelId: "terminal-test",
        windowId: "window-main",
      }),
    });

    const result = await coordinator.start({
      launches: [launch("test", "test")],
      mode: "terminal-tab",
      projectRootPath: "/repo",
      rootTaskId: "test",
    });

    expect(coordinator.runsSnapshot("window-main")).toMatchObject({
      runs: {
        [result.runId]: {
          mode: "terminal-tab",
          nodes: {
            test: { panelId: "terminal-test", status: "running" },
          },
          ownerWindowId: "window-main",
        },
      },
    });
    expect(coordinator.runsSnapshot("window-other").runs).toEqual({});
    expect(
      snapshots.map((snapshot) => (snapshot as { version: number }).version)
    ).toEqual([1, 2, 3]);
  });

  it("marks pending nodes cancelled and running nodes stopping on stop request", async () => {
    const coordinator = createTaskRunCoordinator({
      now: () => 1234,
      openTerminal: async (plan) => ({ panelId: `panel-${plan.taskId}` }),
    });
    const result = await coordinator.start({
      launches: [
        launch("build", "build"),
        launch("verify", "verify", {
          dependsOn: ["build"],
          dependsOrder: "sequence",
        }),
      ],
      projectRootPath: "/repo",
      rootTaskId: "verify",
    });

    expect(coordinator.requestStop(result.runId)).toMatchObject({
      nodes: {
        build: { status: "stopping", stopRequestedAt: 1234 },
        verify: { status: "cancelled", stopRequestedAt: 1234 },
      },
      status: "stopping",
    });
    expect(await coordinator.completePanel("panel-build", 130)).toMatchObject({
      nodes: {
        build: { status: "cancelled" },
        verify: { status: "cancelled" },
      },
      status: "cancelled",
    });
    expect(coordinator.controlStatus(result.runId)?.nodes.build).toMatchObject({
      termination: "interrupt",
    });
  });
  it("runs sequence dependencies one at a time and starts the target after all succeed", async () => {
    const opened: TaskRunLaunchPlan[] = [];
    const coordinator = createTaskRunCoordinator({
      openTerminal: (plan) => {
        opened.push(plan);
        return Promise.resolve({ panelId: `panel-${plan.taskId}` });
      },
    });

    const result = await coordinator.start({
      launches: [
        launch("lint", "lint"),
        launch("test", "test"),
        launch("verify", "verify", {
          dependsOn: ["lint", "test"],
          dependsOrder: "sequence",
        }),
      ],
      projectRootPath: "/repo",
      rootTaskId: "verify",
    });

    expect(opened.map((plan) => plan.taskId)).toEqual(["lint"]);
    expect(result.snapshot.nodes.verify?.status).toBe("pending");

    await coordinator.completePanel("panel-lint", 0);
    expect(opened.map((plan) => plan.taskId)).toEqual(["lint", "test"]);

    await coordinator.completePanel("panel-test", 0);
    expect(opened.map((plan) => plan.taskId)).toEqual([
      "lint",
      "test",
      "verify",
    ]);
    expect(coordinator.status(result.runId)?.nodes.verify?.status).toBe(
      "running"
    );
  });

  it("runs parallel dependencies together and blocks the target until all succeed", async () => {
    const opened: TaskRunLaunchPlan[] = [];
    const coordinator = createTaskRunCoordinator({
      openTerminal: (plan) => {
        opened.push(plan);
        return Promise.resolve({ panelId: `panel-${plan.taskId}` });
      },
    });

    const result = await coordinator.start({
      launches: [
        launch("client", "client"),
        launch("server", "server"),
        launch("verify", "verify", {
          dependsOn: ["client", "server"],
          dependsOrder: "parallel",
        }),
      ],
      projectRootPath: "/repo",
      rootTaskId: "verify",
    });

    expect(opened.map((plan) => plan.taskId).sort()).toEqual([
      "client",
      "server",
    ]);

    await coordinator.completePanel("panel-client", 0);
    expect(opened.map((plan) => plan.taskId).sort()).toEqual([
      "client",
      "server",
    ]);

    await coordinator.completePanel("panel-server", 0);
    expect(opened.map((plan) => plan.taskId).sort()).toEqual([
      "client",
      "server",
      "verify",
    ]);
    expect(coordinator.status(result.runId)?.nodes.verify?.status).toBe(
      "running"
    );
  });

  it("blocks dependent tasks when a dependency fails", async () => {
    const opened: TaskRunLaunchPlan[] = [];
    const coordinator = createTaskRunCoordinator({
      openTerminal: (plan) => {
        opened.push(plan);
        return Promise.resolve({ panelId: `panel-${plan.taskId}` });
      },
    });

    const result = await coordinator.start({
      launches: [
        launch("lint", "lint"),
        launch("verify", "verify", {
          dependsOn: ["lint"],
          dependsOrder: "sequence",
        }),
      ],
      projectRootPath: "/repo",
      rootTaskId: "verify",
    });

    await coordinator.completePanel("panel-lint", 1);

    const snapshot = coordinator.status(result.runId);
    expect(opened.map((plan) => plan.taskId)).toEqual(["lint"]);
    expect(snapshot?.nodes.lint?.status).toBe("failed");
    expect(snapshot?.nodes.verify).toMatchObject({
      blockedBy: "lint",
      status: "blocked",
    });
  });

  it("marks a running task as cancelled when its panel is closed", async () => {
    const coordinator = createTaskRunCoordinator({
      openTerminal: (plan) =>
        Promise.resolve({ panelId: `panel-${plan.taskId}` }),
    });

    const result = await coordinator.start({
      launches: [launch("test", "test")],
      projectRootPath: "/repo",
      rootTaskId: "test",
    });

    coordinator.markPanelClosed("panel-test");

    expect(coordinator.status(result.runId)?.nodes.test?.status).toBe(
      "cancelled"
    );
    expect(await coordinator.completePanel("panel-test", 0)).toBeNull();
  });

  it("uses window id with panel id when completing duplicate panel ids", async () => {
    const coordinator = createTaskRunCoordinator({
      openTerminal: (plan) =>
        Promise.resolve({
          panelId: "terminal-1",
          windowId: `window-${plan.taskId}`,
        }),
    });

    const first = await coordinator.start({
      launches: [launch("first", "first")],
      projectRootPath: "/repo",
      rootTaskId: "first",
    });
    const second = await coordinator.start({
      launches: [launch("second", "second")],
      projectRootPath: "/repo",
      rootTaskId: "second",
    });

    await coordinator.completePanel("terminal-1", 0, "window-first");

    expect(coordinator.status(first.runId)?.nodes.first?.status).toBe(
      "succeeded"
    );
    expect(coordinator.status(second.runId)?.nodes.second?.status).toBe(
      "running"
    );
  });

  it("uses window id with panel id when closing duplicate panel ids", async () => {
    const coordinator = createTaskRunCoordinator({
      openTerminal: (plan) =>
        Promise.resolve({
          panelId: "terminal-1",
          windowId: `window-${plan.taskId}`,
        }),
    });

    const first = await coordinator.start({
      launches: [launch("first", "first")],
      projectRootPath: "/repo",
      rootTaskId: "first",
    });
    const second = await coordinator.start({
      launches: [launch("second", "second")],
      projectRootPath: "/repo",
      rootTaskId: "second",
    });

    coordinator.markPanelClosed("terminal-1", "window-second");

    expect(coordinator.status(first.runId)?.nodes.first?.status).toBe(
      "running"
    );
    expect(coordinator.status(second.runId)?.nodes.second?.status).toBe(
      "cancelled"
    );
  });

  it("marks the next scheduled task failed when terminal open fails after a dependency completes", async () => {
    const coordinator = createTaskRunCoordinator({
      openTerminal: (plan) => {
        if (plan.taskId === "verify") {
          return Promise.reject(new Error("terminal unavailable"));
        }
        return Promise.resolve({ panelId: `panel-${plan.taskId}` });
      },
    });

    const result = await coordinator.start({
      launches: [
        launch("lint", "lint"),
        launch("verify", "verify", {
          dependsOn: ["lint"],
          dependsOrder: "sequence",
        }),
      ],
      projectRootPath: "/repo",
      rootTaskId: "verify",
    });

    await expect(
      coordinator.completePanel("panel-lint", 0)
    ).resolves.toMatchObject({
      nodes: {
        lint: { status: "succeeded" },
        verify: { status: "failed" },
      },
      status: "failed",
    });
    expect(coordinator.status(result.runId)?.nodes.verify?.status).toBe(
      "failed"
    );
  });

  it("keeps the window id returned by terminal open in run snapshots", async () => {
    const coordinator = createTaskRunCoordinator({
      openTerminal: (plan) =>
        Promise.resolve({
          panelId: `panel-${plan.taskId}`,
          windowId: `window-${plan.taskId}`,
        }),
    });

    const result = await coordinator.start({
      launches: [launch("test", "test")],
      projectRootPath: "/repo",
      rootTaskId: "test",
    });

    expect(result.snapshot.nodes.test).toMatchObject({
      panelId: "panel-test",
      status: "running",
      windowId: "window-test",
    });
  });

  it("ignores duplicate completion events after the first terminal result", async () => {
    const opened: TaskRunLaunchPlan[] = [];
    const coordinator = createTaskRunCoordinator({
      openTerminal: (plan) => {
        opened.push(plan);
        return Promise.resolve({ panelId: `panel-${plan.taskId}` });
      },
    });

    const result = await coordinator.start({
      launches: [
        launch("build", "build"),
        launch("verify", "verify", {
          dependsOn: ["build"],
          dependsOrder: "sequence",
        }),
      ],
      projectRootPath: "/repo",
      rootTaskId: "verify",
    });

    await coordinator.completePanel("panel-build", 0);
    await expect(
      coordinator.completePanel("panel-build", 1)
    ).resolves.toBeNull();

    expect(opened.map((plan) => plan.taskId)).toEqual(["build", "verify"]);
    expect(coordinator.status(result.runId)?.nodes.build?.status).toBe(
      "succeeded"
    );
  });

  it("reclaims old finished runs above the retention limit", async () => {
    const coordinator = createTaskRunCoordinator({
      openTerminal: (plan) =>
        Promise.resolve({ panelId: `panel-${plan.taskId}` }),
      retainedRunLimit: 1,
    });

    const first = await coordinator.start({
      launches: [launch("first", "first")],
      projectRootPath: "/repo",
      rootTaskId: "first",
    });
    await coordinator.completePanel("panel-first", 0);

    const second = await coordinator.start({
      launches: [launch("second", "second")],
      projectRootPath: "/repo",
      rootTaskId: "second",
    });
    await coordinator.completePanel("panel-second", 0);

    expect(coordinator.status(first.runId)).toBeNull();
    expect(coordinator.status(second.runId)?.status).toBe("succeeded");
  });

  it("keeps cancelled tasks cancelled when a late terminal completion arrives", async () => {
    const coordinator = createTaskRunCoordinator({
      openTerminal: (plan) =>
        Promise.resolve({ panelId: `panel-${plan.taskId}` }),
    });

    const result = await coordinator.start({
      launches: [launch("test", "test")],
      projectRootPath: "/repo",
      rootTaskId: "test",
    });

    expect(coordinator.cancel(result.runId)?.nodes.test?.status).toBe(
      "cancelled"
    );
    expect(await coordinator.completePanel("panel-test", 0)).toBeNull();
    expect(coordinator.status(result.runId)?.nodes.test?.status).toBe(
      "cancelled"
    );
  });
});
