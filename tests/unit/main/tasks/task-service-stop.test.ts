import { createTerminalTaskLifecycle } from "@main/ipc/terminal-task-lifecycle.ts";
import { createTaskService } from "@main/services/tasks/task-service.ts";
import type { TaskLaunchPlan } from "@shared/contracts/tasks.ts";
import { TASK_STOP_GRACE_MS } from "@shared/contracts/tasks.ts";
import { describe, expect, it, vi } from "vitest";

function launch(): TaskLaunchPlan {
  return {
    command: "pnpm test",
    cwd: "/repo",
    focus: true,
    label: "test",
    presentation: {},
    projectRootPath: "/repo",
    rawCommand: "pnpm test",
    source: "package-script",
    tab: { title: "test" },
    taskId: "package-script:test",
  };
}

async function runningService(now: () => number) {
  const service = createTaskService({
    now,
    readRecentState: async () => ({ entries: [], version: 1 }),
    writeRecentState: async () => undefined,
  });
  const interrupt = vi.fn((): { message?: string; ok: boolean } => ({
    ok: true,
  }));
  const forceStop = vi.fn((): { message?: string; ok: boolean } => ({
    ok: true,
  }));
  service.bindTerminalProcessController({ forceStop, interrupt });
  const started = await service.startRun({
    launches: [launch()],
    openTerminal: async () => ({
      panelId: "terminal-task",
      windowId: "window-main",
    }),
    projectRootPath: "/repo",
    rootTaskId: "package-script:test",
    windowId: "window-main",
  });
  return { forceStop, interrupt, runId: started.runId, service };
}

describe("task service stop policy", () => {
  it("keeps a background run stopping when SIGKILL is rejected", async () => {
    let time = 1000;
    const forceKill = vi.fn(() => false);
    const service = createTaskService({
      now: () => time,
      processEnvironment: {
        resolve: async () => ({
          diagnostics: {
            cacheHit: false,
            pathChanged: false,
            shellEnvStatus: "skipped",
            source: "task",
          },
          env: {},
        }),
      },
      readRecentState: async () => ({ entries: [], version: 1 }),
      spawnBackgroundTask: () => ({
        forceKill,
        interrupt: () => true,
        kill: () => true,
      }),
      writeRecentState: async () => undefined,
    });
    const started = await service.startBackgroundRun({
      launches: [launch()],
      projectRootPath: "/repo",
      rootTaskId: "package-script:test",
      windowId: "window-main",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    service.stopRun(started.runId);
    time += TASK_STOP_GRACE_MS;

    const result = service.stopRun(started.runId, true);

    expect(forceKill).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      failures: [
        {
          message: "background process rejected force stop",
          taskId: "package-script:test",
        },
      ],
      snapshot: { status: "stopping" },
      status: "stopping",
    });
  });

  it("interrupts first and records graceful completion as cancelled", async () => {
    let time = 1000;
    const { forceStop, interrupt, runId, service } = await runningService(
      () => time
    );

    const stopping = service.stopRun(runId);

    expect(interrupt).toHaveBeenCalledWith("terminal-task", "window-main");
    expect(forceStop).not.toHaveBeenCalled();
    expect(stopping).toMatchObject({
      snapshot: {
        nodes: {
          "package-script:test": {
            status: "stopping",
            stopRequestedAt: 1000,
          },
        },
        status: "stopping",
      },
      status: "stopping",
    });
    service.stopRun(runId);
    expect(interrupt).toHaveBeenCalledTimes(1);

    time += 10;
    await service.completePanel("terminal-task", 130, "window-main");

    expect(service.runsSnapshot("window-main")).toMatchObject({
      runs: {
        [runId]: {
          nodes: {
            "package-script:test": {
              status: "cancelled",
              termination: "interrupt",
            },
          },
          status: "cancelled",
        },
      },
    });
  });

  it("allows force stop only after the shared grace period", async () => {
    let time = 2000;
    const { forceStop, runId, service } = await runningService(() => time);
    service.stopRun(runId);

    time += TASK_STOP_GRACE_MS - 1;
    expect(service.stopRun(runId, true)?.status).toBe("stopping");
    expect(forceStop).not.toHaveBeenCalled();

    time += 1;
    const stopped = service.stopRun(runId, true);

    expect(forceStop).toHaveBeenCalledWith("terminal-task", "window-main");
    expect(stopped).toMatchObject({
      snapshot: {
        nodes: {
          "package-script:test": {
            status: "cancelled",
            termination: "force",
          },
        },
        status: "cancelled",
      },
      status: "force-stopped",
    });
    expect(service.isStopRequested("terminal-task", "window-main")).toBe(true);
  });

  it("keeps a run stopping when the terminal rejects force stop", async () => {
    let time = 3000;
    const { forceStop, runId, service } = await runningService(() => time);
    forceStop.mockReturnValue({ message: "native close failed", ok: false });
    service.stopRun(runId);
    time += TASK_STOP_GRACE_MS;

    const result = service.stopRun(runId, true);

    expect(result).toMatchObject({
      failures: [
        { message: "native close failed", taskId: "package-script:test" },
      ],
      snapshot: { status: "stopping" },
      status: "stopping",
    });
  });

  it("rolls a graceful stop back to running when the terminal rejects Ctrl+C", async () => {
    const { interrupt, runId, service } = await runningService(() => 3500);
    interrupt.mockReturnValue({
      message: "terminal rejected the interrupt",
      ok: false,
    });

    const result = service.stopRun(runId);

    expect(result).toMatchObject({
      failures: [
        {
          message: "terminal rejected the interrupt",
          taskId: "package-script:test",
        },
      ],
      snapshot: {
        nodes: {
          "package-script:test": { status: "running" },
        },
        status: "running",
      },
      status: "rejected",
    });
    expect(result?.snapshot.nodes["package-script:test"]).not.toHaveProperty(
      "stopRequestedAt"
    );
    expect(service.isStopRequested("terminal-task", "window-main")).toBe(false);
  });

  it("keeps a partially stopped multi-process run active", async () => {
    const service = createTaskService({
      now: () => 3600,
      readRecentState: async () => ({ entries: [], version: 1 }),
      writeRecentState: async () => undefined,
    });
    const interrupt = vi.fn((panelId: string) =>
      panelId === "terminal-client"
        ? { message: "client rejected Ctrl+C", ok: false }
        : { ok: true }
    );
    service.bindTerminalProcessController({
      forceStop: vi.fn(() => ({ ok: true })),
      interrupt,
    });
    const task = launch();
    const started = await service.startRun({
      launches: [
        { ...task, label: "client", taskId: "client" },
        { ...task, label: "server", taskId: "server" },
        {
          ...task,
          dependsOn: ["client", "server"],
          dependsOrder: "parallel",
          label: "verify",
          taskId: "verify",
        },
      ],
      openTerminal: async (plan) => ({
        panelId: `terminal-${plan.taskId}`,
        windowId: "window-main",
      }),
      projectRootPath: "/repo",
      rootTaskId: "verify",
      windowId: "window-main",
    });

    const stopping = service.stopRun(started.runId);

    expect(stopping).toMatchObject({
      failures: [{ message: "client rejected Ctrl+C", taskId: "client" }],
      snapshot: {
        nodes: {
          client: { status: "running" },
          server: { status: "stopping" },
          verify: { status: "cancelled" },
        },
        status: "stopping",
      },
      status: "partially-stopping",
    });

    await service.completePanel("terminal-server", 130, "window-main");
    expect(service.statusRun(started.runId)).toMatchObject({
      nodes: { client: { status: "running" } },
      status: "running",
    });
  });

  it("publishes one cancelled run when terminal lifecycle confirms an interrupted process", async () => {
    let time = 4000;
    const broadcasts: Array<{ runs: Record<string, { status: string }> }> = [];
    const service = createTaskService({
      now: () => time,
      onTaskRunsChanged: (snapshot) => broadcasts.push(snapshot),
      readRecentState: async () => ({ entries: [], version: 1 }),
      writeRecentState: async () => undefined,
    });
    service.bindTerminalProcessController({
      forceStop: vi.fn(() => ({ ok: true })),
      interrupt: vi.fn(() => ({ ok: true })),
    });
    const started = await service.startRun({
      launches: [launch()],
      openTerminal: async () => ({
        panelId: "terminal-task",
        windowId: "window-main",
      }),
      projectRootPath: "/repo",
      rootTaskId: "package-script:test",
      windowId: "window-main",
    });
    const patchTaskStatus = vi.fn(async () => true);
    const lifecycle = createTerminalTaskLifecycle({
      completePanel: (panelId, exitCode, lifecycleId, windowId) =>
        service.completePanel(panelId, exitCode, windowId, lifecycleId),
      isStopRequested: (panelId, windowId) =>
        service.isStopRequested(panelId, windowId),
      markPanelClosed: (panelId, windowId) =>
        service.markPanelClosed(panelId, windowId),
      now: () => time,
      patchTab: vi.fn(async () => undefined),
      patchTaskStatus,
      sessionScopeForBrowserWindow: () => "session-main",
    });
    lifecycle.resetPanel("terminal-task", started.runId, "window-main");

    service.stopRun(started.runId);
    time += 10;
    await lifecycle.completeFromExitCodeHint({
      browserWindowId: 42,
      lifecycleId: started.runId,
      code: 130,
      panelId: "terminal-task",
      source: "task-exit-marker",
      windowId: "window-main",
    });

    expect(patchTaskStatus).toHaveBeenCalledWith(
      "session-main",
      "terminal-task",
      started.runId,
      expect.objectContaining({ status: "cancelled" })
    );
    expect(
      service.runsSnapshot("window-main").runs[started.runId]
    ).toMatchObject({
      nodes: {
        "package-script:test": {
          exitCode: 130,
          status: "cancelled",
          termination: "interrupt",
        },
      },
      status: "cancelled",
    });
    expect(broadcasts.at(-1)?.runs[started.runId]?.status).toBe("cancelled");
  });
});
