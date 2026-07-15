import type { TaskRunControlEntry } from "@shared/contracts/tasks.ts";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTaskRunFinishedNotificationsForTests } from "@/panel-kits/terminal/notify-task-run-finished.ts";
import {
  currentTaskRunsByLogicalTask,
  RUNTIME_CONTROL_EXIT_MS,
  useTerminalRuntimeControlPresentation,
} from "@/panel-kits/terminal/use-terminal-runtime-control-presentation.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/actions/task-run-operations.ts", () => ({
  openTaskRunOutput: vi.fn(async () => undefined),
  revealTaskRun: vi.fn(async () => true),
}));

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
    clearTaskRunFinishedNotificationsForTests();
  });

  afterEach(() => {
    useTaskRunsStore.setState({
      error: null,
      initialized: false,
      snapshot: { runs: {}, version: 0 },
    });
    clearTaskRunFinishedNotificationsForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("exits finished runs immediately and unmounts after the exit animation", () => {
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
      phase: "exiting",
    });
    expect(result.current.runs[0]?.status).toBe("succeeded");

    act(() => {
      vi.advanceTimersByTime(RUNTIME_CONTROL_EXIT_MS);
    });
    expect(result.current.mounted).toBe(false);
  });

  it("exits failures immediately without a linger window", () => {
    publish(run("running"));
    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );

    act(() => {
      publish(run("failed"), 2);
    });
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

  it("does not present a finished run that arrives without an active phase", () => {
    publish(run("failed"));
    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );

    expect(result.current.mounted).toBe(false);
    expect(result.current.runs).toHaveLength(0);
  });

  it("does not present runtime controls in a task output panel", () => {
    publish(run("running"));

    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("task-output-run-1-test")
    );

    expect(result.current.mounted).toBe(false);
    expect(result.current.runs).toHaveLength(0);
  });

  it("cancels an in-flight exit when a new active run arrives", () => {
    publish(run("running"));
    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );
    act(() => {
      publish(run("succeeded"), 2);
    });
    expect(result.current.phase).toBe("exiting");

    act(() => {
      publish({ ...run("running"), runId: "run-2", updatedAt: Date.now() }, 3);
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

    expect(result.current.runs).toHaveLength(0);
    expect(
      currentTaskRunsByLogicalTask([
        run("failed", { runId: "run-1", updatedAt: 1000 }),
        run("failed", { runId: "run-2", updatedAt: 2000 }),
        run("failed", { runId: "run-3", updatedAt: 3000 }),
      ]).map((entry) => entry.runId)
    ).toEqual(["run-3"]);
  });

  it("does not restore an older failure after a newer success exits", () => {
    publish(run("running", { runId: "run-2", updatedAt: 5000 }));
    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );

    act(() => {
      publish(
        [
          run("failed", { runId: "run-1", updatedAt: 0 }),
          run("succeeded", { runId: "run-2", updatedAt: 5000 }),
        ],
        2
      );
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
    publish(run("running"));
    const { result } = renderHook(() =>
      useTerminalRuntimeControlPresentation("terminal-task")
    );

    act(() => {
      publish(run("succeeded"), 2);
    });
    expect(result.current.phase).toBe("exiting");
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(result.current.mounted).toBe(false);
  });
});
