import type { TaskRunControlEntry } from "@shared/contracts/tasks.ts";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentTaskRunsByLogicalTask,
  RUNTIME_CONTROL_CANCELLED_LINGER_MS,
  RUNTIME_CONTROL_EXIT_MS,
  RUNTIME_CONTROL_SUCCESS_LINGER_MS,
  useTerminalRuntimeControlPresentation,
} from "@/panel-kits/terminal/use-terminal-runtime-control-presentation.ts";
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
  });

  afterEach(() => {
    useTaskRunsStore.setState({
      error: null,
      initialized: false,
      snapshot: { runs: {}, version: 0 },
    });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps a successful result visible for five seconds before exiting", () => {
    expect(RUNTIME_CONTROL_SUCCESS_LINGER_MS).toBe(5000);
    expect(RUNTIME_CONTROL_EXIT_MS).toBe(180);

    publish(run("succeeded"));
    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(result.current).toMatchObject({
      mounted: true,
      phase: "visible",
    });
    expect(result.current.runs).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toMatchObject({
      mounted: true,
      phase: "exiting",
    });
    expect(result.current.runs).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(RUNTIME_CONTROL_EXIT_MS);
    });
    expect(result.current.mounted).toBe(false);
    expect(result.current.runs).toHaveLength(0);
  });

  it("freezes the remaining success linger while keeping public time current", () => {
    publish(run("succeeded"));
    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    const nowBeforePause = result.current.now;

    act(() => {
      result.current.setAutoExitPause(true);
    });
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current.phase).toBe("visible");
    expect(result.current.now).toBe(nowBeforePause + 4000);

    act(() => {
      result.current.setAutoExitPause(false);
    });
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(result.current.phase).toBe("visible");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.phase).toBe("exiting");
  });

  it("keeps repeated floating interaction updates idempotent", () => {
    publish(run("succeeded"));
    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );

    act(() => {
      vi.advanceTimersByTime(1000);
      result.current.setAutoExitPause(true);
    });
    act(() => {
      vi.advanceTimersByTime(2000);
      result.current.setAutoExitPause(true);
      vi.advanceTimersByTime(4000);
    });
    expect(result.current.phase).toBe("visible");

    act(() => {
      result.current.setAutoExitPause(false);
      vi.advanceTimersByTime(3999);
    });
    expect(result.current.phase).toBe("visible");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.phase).toBe("exiting");
  });

  it("dismisses a persistent result immediately while auto-exit is paused", () => {
    publish(run("failed"));
    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );

    act(() => {
      result.current.setAutoExitPause(true);
      result.current.dismissRun("run-1");
    });

    expect(result.current).toMatchObject({
      mounted: true,
      phase: "exiting",
    });
    expect(result.current.runs[0]?.status).toBe("failed");
  });

  it("keeps failures visible until the user dismisses them", () => {
    publish(run("failed", { updatedAt: 0 }));
    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toMatchObject({
      mounted: true,
      phase: "visible",
    });

    act(() => result.current.dismissRun("run-1"));
    expect(result.current).toMatchObject({
      mounted: true,
      phase: "exiting",
    });
    expect(result.current.runs[0]?.status).toBe("failed");

    act(() => {
      vi.advanceTimersByTime(RUNTIME_CONTROL_EXIT_MS);
    });
    expect(result.current.mounted).toBe(false);
  });

  it("does not present runtime controls in a task output panel", () => {
    publish(run("running"));

    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("task-output-run-1-test")
    );

    expect(result.current.mounted).toBe(false);
    expect(result.current.runs).toHaveLength(0);
  });

  it("treats force-stopped runs as persistent but lets ordinary cancellation expire", () => {
    publish(run("cancelled", { force: true, updatedAt: 0 }));
    const { result, rerender } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.mounted).toBe(true);

    publish(run("cancelled", { updatedAt: Date.now() }), 2);
    rerender();
    act(() => {
      vi.advanceTimersByTime(RUNTIME_CONTROL_CANCELLED_LINGER_MS);
    });
    expect(result.current.phase).toBe("exiting");
  });

  it("cancels an in-flight exit when a new active run arrives", () => {
    publish(run("succeeded"));
    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );
    act(() => {
      vi.advanceTimersByTime(RUNTIME_CONTROL_SUCCESS_LINGER_MS);
    });
    expect(result.current.phase).toBe("exiting");

    act(() => {
      publish({ ...run("running"), runId: "run-2", updatedAt: Date.now() }, 2);
    });
    expect(result.current).toMatchObject({
      mounted: true,
      phase: "visible",
    });
    expect(result.current.runs[0]?.runId).toBe("run-2");

    act(() => {
      vi.advanceTimersByTime(RUNTIME_CONTROL_EXIT_MS);
    });
    expect(result.current.mounted).toBe(true);
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
  });

  it("does not restore an older failure after a newer success expires", () => {
    publish([
      run("failed", { runId: "run-1", updatedAt: 0 }),
      run("succeeded", { runId: "run-2", updatedAt: 5000 }),
    ]);
    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );

    expect(result.current.runs.map((entry) => entry.runId)).toEqual(["run-2"]);
    act(() => {
      vi.advanceTimersByTime(RUNTIME_CONTROL_SUCCESS_LINGER_MS);
    });
    expect(result.current.phase).toBe("exiting");
    expect(result.current.runs.map((entry) => entry.runId)).toEqual(["run-2"]);
    act(() => {
      vi.advanceTimersByTime(RUNTIME_CONTROL_EXIT_MS);
    });
    expect(result.current.runs).toHaveLength(0);
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

  it("removes the presentation immediately when reduced motion is requested", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true }))
    );
    publish(run("failed"));
    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );

    act(() => result.current.dismissRun("run-1"));
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current.mounted).toBe(false);
  });
});
