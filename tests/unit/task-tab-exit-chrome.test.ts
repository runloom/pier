import type { PanelTabChrome } from "@shared/contracts/panel.ts";
import type {
  TaskPanelMetadata,
  TaskRunsSnapshot,
} from "@shared/contracts/tasks.ts";
import { describe, expect, it } from "vitest";
import {
  activityTabChromeOverlay,
  mergeTabChrome,
  taskRunTabChromeOverlay,
} from "@/panel-kits/terminal/terminal-tab-chrome.ts";

describe("task exit tab chrome uses TaskRuns as single live source", () => {
  function runningBase(): PanelTabChrome {
    return {
      state: { label: "Running", status: "running" },
      title: "npm build",
    };
  }

  function task(runId: string): TaskPanelMetadata {
    return {
      cwd: "/repo",
      label: "npm build",
      projectRootPath: "/repo",
      rawCommand: "npm run build",
      runId,
      source: "package-script",
      startedAt: 1,
      status: "running",
      taskId: "build",
    };
  }

  function runsSnapshot(
    runId: string,
    status: "failed" | "running" | "succeeded"
  ): TaskRunsSnapshot {
    return {
      runs: {
        [runId]: {
          mode: "terminal-tab",
          nodes: {
            build: {
              label: "npm build",
              panelId: "p1",
              status,
              taskId: "build",
              ...(status === "failed" ? { exitCode: 1 } : {}),
            },
          },
          projectRootPath: "/repo",
          rootTaskId: "build",
          runId,
          startedAt: 1,
          status,
          updatedAt: 2,
        },
      },
      version: 2,
    };
  }

  it("TaskRuns overlay shows succeeded instead of stale running base", () => {
    const merged = mergeTabChrome(
      runningBase(),
      taskRunTabChromeOverlay(
        "p1",
        runsSnapshot("run-1", "succeeded"),
        task("run-1")
      )
    );

    expect(merged?.state?.status).toBe("succeeded");
    expect(merged?.title).toBe("npm build");
  });

  it("TaskRuns overlay shows failed with exit code", () => {
    const merged = mergeTabChrome(
      runningBase(),
      taskRunTabChromeOverlay(
        "p1",
        runsSnapshot("run-1", "failed"),
        task("run-1")
      )
    );

    expect(merged?.state?.status).toBe("failed");
    expect(merged?.state?.label).toBe("Failed 1");
  });

  it("activity overlay for task only contributes title, not status", () => {
    const overlay = activityTabChromeOverlay(
      {
        kind: "task",
        label: "npm build",
        panelId: "p1",
        runId: "run-1",
        spawnedAt: 1,
        taskId: "build",
        updatedAt: 2,
        windowId: "1",
      },
      { taskRuns: runsSnapshot("run-1", "running") }
    );

    expect(overlay).toEqual({ title: "npm build" });
    expect(overlay?.state).toBeUndefined();
  });

  it("keeps a restarted panel on the new run when the old run finished", () => {
    const merged = mergeTabChrome(
      mergeTabChrome(runningBase(), { title: "npm build" }),
      taskRunTabChromeOverlay(
        "p1",
        runsSnapshot("run-new", "running"),
        task("run-old")
      )
    );

    expect(merged?.state).toMatchObject({
      label: "Running",
      status: "running",
    });
  });

  it("keeps running tab overlay during relaunch while TaskRuns still report active", () => {
    const relaunchBase = mergeTabChrome(runningBase(), { title: "npm build" });
    const duringRelaunch = mergeTabChrome(
      relaunchBase,
      taskRunTabChromeOverlay(
        "p1",
        runsSnapshot("run-1", "running"),
        task("run-1")
      )
    );

    expect(duringRelaunch?.state).toMatchObject({
      label: "Running",
      status: "running",
    });
    expect(
      activityTabChromeOverlay(
        {
          kind: "task",
          label: "npm build",
          panelId: "p1",
          runId: "run-1",
          spawnedAt: 1,
          taskId: "build",
          updatedAt: 2,
          windowId: "1",
        },
        { taskRuns: runsSnapshot("run-1", "running") }
      )?.state
    ).toBeUndefined();
  });

  it("ignores stale foreground task title when the run is no longer active", () => {
    expect(
      activityTabChromeOverlay(
        {
          kind: "task",
          label: "npm build",
          panelId: "p1",
          runId: "run-1",
          spawnedAt: 1,
          taskId: "build",
          updatedAt: 2,
          windowId: "1",
        },
        { taskRuns: runsSnapshot("run-1", "succeeded") }
      )
    ).toBeNull();
  });

  it("does not show task tab loading on a background origin shell", () => {
    const snapshot: TaskRunsSnapshot = {
      runs: {
        "run-bg": {
          mode: "background",
          nodes: {
            dev: {
              label: "dev",
              panelId: "background-task:run-bg:dev",
              status: "running",
              taskId: "dev",
            },
          },
          originPanelId: "p1",
          projectRootPath: "/repo",
          rootTaskId: "dev",
          runId: "run-bg",
          startedAt: 1,
          status: "running",
          updatedAt: 2,
        },
      },
      version: 1,
    };

    expect(taskRunTabChromeOverlay("p1", snapshot)).toBeNull();
  });
});
