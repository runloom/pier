import type { TaskRunControlEntry } from "@shared/contracts/tasks.ts";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentTaskRunsByLogicalTask,
  RUNTIME_CONTROL_EXIT_MS,
  useTerminalRuntimeControlPresentation,
} from "@/panel-kits/terminal/hooks/use-runtime-control-presentation.ts";
import { useTaskRunControlDismissStore } from "@/stores/task-run-control-dismiss.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";

function run(
  status: TaskRunControlEntry["status"],
  options: {
    force?: boolean;
    mode?: TaskRunControlEntry["mode"];
    runId?: string;
    startedAt?: number;
    taskId?: string;
    updatedAt?: number;
  } = {}
): TaskRunControlEntry {
  const taskId = options.taskId ?? "test";
  return {
    mode: options.mode ?? "terminal-tab",
    nodes: {
      [taskId]: {
        label: taskId === "test" ? "Test suite" : taskId,
        panelId: "terminal-task",
        status,
        taskId,
        ...(options.force ? { termination: "force" as const } : {}),
      },
    },
    projectRootPath: "/repo",
    rootTaskId: taskId,
    runId: options.runId ?? "run-1",
    startedAt: options.startedAt ?? 1000,
    status,
    updatedAt: options.updatedAt ?? 5000,
  };
}

function publish(
  current: TaskRunControlEntry | readonly TaskRunControlEntry[],
  version = 1
): void {
  const runs = Array.isArray(current) ? current : [current];
  useTaskRunsStore.setState({
    error: null,
    initialized: true,
    snapshot: {
      runs: Object.fromEntries(runs.map((entry) => [entry.runId, entry])),
      version,
    },
  });
}

describe("terminal runtime control presentation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(5000);
    useTaskRunControlDismissStore.getState().clearForTests();
  });

  afterEach(() => {
    useTaskRunsStore.setState({
      error: null,
      initialized: false,
      snapshot: { runs: {}, version: 0 },
    });
    useTaskRunControlDismissStore.getState().clearForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps finished terminal-tab runs mounted until dismissed", () => {
    expect(RUNTIME_CONTROL_EXIT_MS).toBe(180);

    publish(run("running"));
    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );
    expect(result.current).toMatchObject({
      mounted: true,
      phase: "visible",
    });

    act(() => {
      publish(run("succeeded"), 2);
    });
    expect(result.current).toMatchObject({
      mounted: true,
      phase: "visible",
    });
    expect(result.current.runs[0]?.status).toBe("succeeded");

    act(() => {
      vi.advanceTimersByTime(RUNTIME_CONTROL_EXIT_MS);
    });
    expect(result.current.mounted).toBe(true);
  });

  it("keeps finished background runs mounted until dismissed", () => {
    publish(run("running", { mode: "background" }));
    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );

    act(() => {
      publish(run("succeeded", { mode: "background" }), 2);
    });
    expect(result.current).toMatchObject({
      mounted: true,
      phase: "visible",
    });

    act(() => {
      result.current.dismissRun("run-1");
    });
    expect(result.current.phase).toBe("exiting");
    act(() => {
      vi.advanceTimersByTime(RUNTIME_CONTROL_EXIT_MS);
    });
    expect(result.current.mounted).toBe(false);
  });

  it("presents a finished run that arrives without an active phase", () => {
    publish(run("failed"));
    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );

    expect(result.current.mounted).toBe(true);
    expect(result.current.runs[0]?.status).toBe("failed");
  });

  it("does not present runtime controls in a task output panel", () => {
    publish(run("running"));

    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("task-output-run-1-test")
    );

    expect(result.current.mounted).toBe(false);
    expect(result.current.runs).toHaveLength(0);
  });

  it("shows a new runId after dismiss without undismissing the old id", () => {
    publish(run("succeeded"));
    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );
    act(() => {
      result.current.dismissRun("run-1");
    });
    act(() => {
      vi.advanceTimersByTime(RUNTIME_CONTROL_EXIT_MS);
    });
    expect(result.current.mounted).toBe(false);

    act(() => {
      publish({ ...run("running"), runId: "run-2", updatedAt: Date.now() }, 2);
    });
    expect(result.current).toMatchObject({
      mounted: true,
      phase: "visible",
    });
    expect(result.current.runs[0]?.runId).toBe("run-2");
  });

  it("keeps graceful-stop dismiss while the same run stays stopping across snapshot bumps", () => {
    publish(run("running"));
    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );

    act(() => {
      result.current.dismissRun("run-1");
    });
    expect(result.current.phase).toBe("exiting");

    // 优雅停止后常见：同一 runId 仍为 stopping，随后又有 snapshot 版本推进。
    act(() => {
      publish(
        run("stopping", {
          runId: "run-1",
          updatedAt: 6000,
        }),
        2
      );
    });
    act(() => {
      vi.advanceTimersByTime(RUNTIME_CONTROL_EXIT_MS);
    });
    expect(result.current.mounted).toBe(false);

    act(() => {
      publish(
        run("cancelled", {
          runId: "run-1",
          updatedAt: 7000,
        }),
        3
      );
    });
    expect(result.current.mounted).toBe(false);
  });

  it("shows only the current terminal run after repeated reruns", () => {
    publish([
      run("failed", { runId: "run-1", updatedAt: 1000 }),
      run("failed", { runId: "run-2", updatedAt: 2000 }),
      run("failed", { runId: "run-3", updatedAt: 3000 }),
    ]);

    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );

    expect(result.current.runs.map((entry) => entry.runId)).toEqual(["run-3"]);
    expect(
      currentTaskRunsByLogicalTask([
        run("failed", { runId: "run-1", updatedAt: 1000 }),
        run("failed", { runId: "run-2", updatedAt: 2000 }),
        run("failed", { runId: "run-3", updatedAt: 3000 }),
      ]).map((entry) => entry.runId)
    ).toEqual(["run-3"]);
  });

  it("keeps different tasks and concurrent active runs independently controllable", () => {
    const current = currentTaskRunsByLogicalTask([
      run("failed", { runId: "old-failure", updatedAt: 1000 }),
      run("running", { runId: "active-1", updatedAt: 2000 }),
      run("running", { runId: "active-2", updatedAt: 3000 }),
      run("failed", {
        runId: "other-task",
        taskId: "build",
        updatedAt: 2500,
      }),
    ]);

    expect(current.map((entry) => entry.runId)).toEqual([
      "active-2",
      "active-1",
      "other-task",
    ]);
  });
});
