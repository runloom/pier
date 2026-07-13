import type { NativeAddon } from "@main/ipc/terminal-native-addon.ts";
import { createTaskOutputTerminalBindings } from "@main/ipc/terminal-task-output-bindings.ts";
import type { TaskService } from "@main/services/tasks/task-service.ts";
import type {
  TaskOutputUpdate,
  TaskRunsSnapshot,
} from "@shared/contracts/tasks.ts";
import { describe, expect, it, vi } from "vitest";

function runningSnapshot(status: "failed" | "running" = "running") {
  return {
    runs: {
      "run-1": {
        mode: "background",
        nodes: {
          build: {
            ...(status === "failed" ? { exitCode: 2 } : {}),
            label: "Build",
            status,
            taskId: "build",
          },
        },
        ownerWindowId: "main",
        projectRootPath: "/project",
        rootTaskId: "build",
        runId: "run-1",
        startedAt: 100,
        status,
        updatedAt: status === "failed" ? 250 : 120,
      },
    },
    version: status === "failed" ? 2 : 1,
  } satisfies TaskRunsSnapshot;
}

describe("task output terminal bindings", () => {
  it("restores the previous binding when reload reconciliation cannot hydrate", () => {
    let outputListener:
      | ((update: TaskOutputUpdate, windowId?: string) => void)
      | undefined;
    const writes: string[] = [];
    const addon = {
      finishTerminalOutput: vi.fn(() => true),
      resetTerminalOutput: vi.fn(() => true),
      writeTerminalOutput: vi.fn((_panelId: string, data: Buffer) => {
        const text = data.toString("utf8");
        writes.push(text);
        return !text.includes("new output");
      }),
    } as unknown as NativeAddon;
    const taskService = {
      output: vi.fn((runId: string) => ({
        chunks: [
          {
            sequence: 1,
            stream: "stdout" as const,
            text: runId === "run-new" ? "new output\n" : "old output\n",
          },
        ],
        firstSequence: 1,
        runId,
        taskId: "build",
        truncated: false,
        version: 1,
      })),
      runsSnapshot: vi.fn(() => ({ runs: {}, version: 0 })),
      subscribeOutput: vi.fn((listener) => {
        outputListener = listener;
        return vi.fn();
      }),
      subscribeRuns: vi.fn(() => vi.fn()),
    } as unknown as TaskService;
    const onSurfaceReset = vi.fn();
    const bindings = createTaskOutputTerminalBindings({
      addon,
      onSurfaceReset,
      taskService,
    });
    expect(
      bindings.attach({
        browserWindowId: 7,
        nativePanelId: "7::output",
        ownerWindowId: "main",
        params: { label: "Build", runId: "run-old", taskId: "build" },
      })
    ).toEqual({ ok: true });

    expect(
      bindings.attach({
        browserWindowId: 7,
        nativePanelId: "7::output",
        ownerWindowId: "main",
        params: { label: "Build", runId: "run-new", taskId: "build" },
      })
    ).toEqual({ error: "native terminal rejected task output", ok: false });
    expect(onSurfaceReset).toHaveBeenCalledTimes(2);
    expect(onSurfaceReset).toHaveBeenLastCalledWith(7, "7::output");

    outputListener?.(
      {
        chunks: [{ sequence: 2, stream: "stdout", text: "old live\n" }],
        firstSequence: 1,
        runId: "run-old",
        taskId: "build",
        truncated: false,
        version: 2,
      },
      "main"
    );
    expect(writes.join("")).toContain("old live\r\n");
  });

  it("replays ANSI output once, appends ordered increments and finishes the terminal", () => {
    let outputListener:
      | ((update: TaskOutputUpdate, windowId?: string) => void)
      | undefined;
    let runsListener: ((snapshot: TaskRunsSnapshot) => void) | undefined;
    const writes: string[] = [];
    const finishTerminalOutput = vi.fn(() => true);
    const addon = {
      finishTerminalOutput,
      writeTerminalOutput: vi.fn((_panelId: string, data: Buffer) => {
        writes.push(data.toString("utf8"));
        return true;
      }),
    } as unknown as NativeAddon;
    const output: TaskOutputUpdate = {
      chunks: [
        { sequence: 1, stream: "stdout", text: "\u001B[31mred\u001B[0m\n" },
        { sequence: 2, stream: "stderr", text: "error\r\n" },
      ],
      firstSequence: 1,
      runId: "run-1",
      taskId: "build",
      truncated: false,
      version: 2,
    };
    const taskService = {
      output: vi.fn(() => output),
      runsSnapshot: vi.fn(() => runningSnapshot()),
      subscribeOutput: vi.fn((listener) => {
        outputListener = listener;
        return vi.fn();
      }),
      subscribeRuns: vi.fn((listener) => {
        runsListener = listener;
        return vi.fn();
      }),
    } as unknown as TaskService;
    const bindings = createTaskOutputTerminalBindings({ addon, taskService });
    const attachArgs = {
      browserWindowId: 7,
      nativePanelId: "7::task-output-run-1-build",
      ownerWindowId: "main",
      params: { label: "Build", runId: "run-1", taskId: "build" },
    };

    expect(bindings.attach(attachArgs)).toEqual({ ok: true });
    expect(writes.join("")).toBe("\u001B[31mred\u001B[0m\r\nerror\r\n");

    outputListener?.(
      {
        ...output,
        chunks: [
          output.chunks[1]!,
          { sequence: 3, stream: "stdout", text: "done\n" },
        ],
        version: 3,
      },
      "main"
    );
    expect(writes.join("")).toContain("done\r\n");
    expect(writes.join("").match(/error/g)).toHaveLength(1);

    runsListener?.(runningSnapshot("failed"));
    expect(finishTerminalOutput).toHaveBeenCalledWith(
      "7::task-output-run-1-build",
      2,
      150
    );

    expect(bindings.attach(attachArgs)).toEqual({ ok: true });
    expect(taskService.output).toHaveBeenCalledTimes(1);
  });

  it("drops a binding when its terminal is no longer retained", () => {
    let outputListener:
      | ((update: TaskOutputUpdate, windowId?: string) => void)
      | undefined;
    const writeTerminalOutput = vi.fn(() => true);
    const addon = {
      finishTerminalOutput: vi.fn(() => true),
      writeTerminalOutput,
    } as unknown as NativeAddon;
    const taskService = {
      output: vi.fn(() => ({
        chunks: [],
        firstSequence: 1,
        runId: "run-1",
        taskId: "build",
        truncated: false,
        version: 0,
      })),
      runsSnapshot: vi.fn(() => ({ runs: {}, version: 0 })),
      subscribeOutput: vi.fn((listener) => {
        outputListener = listener;
        return vi.fn();
      }),
      subscribeRuns: vi.fn(() => vi.fn()),
    } as unknown as TaskService;
    const bindings = createTaskOutputTerminalBindings({ addon, taskService });
    bindings.attach({
      browserWindowId: 7,
      nativePanelId: "7::output",
      ownerWindowId: "main",
      params: { label: "Build", runId: "run-1", taskId: "build" },
    });

    bindings.retainWindow(7, []);
    outputListener?.(
      {
        chunks: [{ sequence: 1, stream: "stdout", text: "late\n" }],
        firstSequence: 1,
        runId: "run-1",
        taskId: "build",
        truncated: false,
        version: 1,
      },
      "main"
    );
    expect(writeTerminalOutput).not.toHaveBeenCalled();
  });

  it("rebinds one native output terminal to a newer generation and rejects stale requests", () => {
    let outputListener:
      | ((update: TaskOutputUpdate, windowId?: string) => void)
      | undefined;
    const writes: string[] = [];
    const resetTerminalOutput = vi.fn(() => true);
    const addon = {
      finishTerminalOutput: vi.fn(() => true),
      resetTerminalOutput,
      writeTerminalOutput: vi.fn((_panelId: string, data: Buffer) => {
        writes.push(data.toString("utf8"));
        return true;
      }),
    } as unknown as NativeAddon;
    const outputs: Record<string, TaskOutputUpdate> = {
      "run-1": {
        chunks: [{ sequence: 1, stream: "stdout", text: "first\n" }],
        firstSequence: 1,
        runId: "run-1",
        taskId: "build",
        truncated: false,
        version: 1,
      },
      "run-2": {
        chunks: [{ sequence: 1, stream: "stdout", text: "second\n" }],
        firstSequence: 1,
        runId: "run-2",
        taskId: "build",
        truncated: false,
        version: 1,
      },
    };
    const taskService = {
      output: vi.fn((runId: string) => outputs[runId] ?? null),
      runsSnapshot: vi.fn(() => ({ runs: {}, version: 0 })),
      subscribeOutput: vi.fn((listener) => {
        outputListener = listener;
        return vi.fn();
      }),
      subscribeRuns: vi.fn(() => vi.fn()),
    } as unknown as TaskService;
    const bindings = createTaskOutputTerminalBindings({ addon, taskService });
    bindings.attach({
      browserWindowId: 7,
      nativePanelId: "7::output",
      ownerWindowId: "main",
      params: { label: "Build", runId: "run-1", taskId: "build" },
    });

    expect(
      bindings.rebind({
        nativePanelId: "7::output",
        ownerWindowId: "main",
        params: {
          contextId: "ctx-project",
          generation: 1,
          label: "Build",
          projectRootPath: "/project",
          selectedRunId: "run-2",
          taskId: "build",
          version: 2,
        },
      })
    ).toEqual({ generation: 1, ok: true });
    expect(resetTerminalOutput).toHaveBeenCalledTimes(1);
    expect(writes.join("")).toContain("second\r\n");

    expect(
      bindings.rebind({
        nativePanelId: "7::output",
        ownerWindowId: "main",
        params: {
          contextId: "ctx-project",
          generation: 0,
          label: "Build",
          projectRootPath: "/project",
          selectedRunId: "run-1",
          taskId: "build",
          version: 2,
        },
      })
    ).toEqual({ generation: 1, ok: true, stale: true });
    expect(resetTerminalOutput).toHaveBeenCalledTimes(1);

    outputListener?.(
      {
        chunks: [{ sequence: 2, stream: "stdout", text: "old-late\n" }],
        firstSequence: 1,
        runId: "run-1",
        taskId: "build",
        truncated: false,
        version: 2,
      },
      "main"
    );
    expect(writes.join("")).not.toContain("old-late");
  });

  it("keeps the previous binding when native reset fails", () => {
    let outputListener:
      | ((update: TaskOutputUpdate, windowId?: string) => void)
      | undefined;
    const writes: string[] = [];
    const addon = {
      finishTerminalOutput: vi.fn(() => true),
      resetTerminalOutput: vi.fn(() => false),
      writeTerminalOutput: vi.fn((_panelId: string, data: Buffer) => {
        writes.push(data.toString("utf8"));
        return true;
      }),
    } as unknown as NativeAddon;
    const taskService = {
      output: vi.fn((runId: string) => ({
        chunks: [
          { sequence: 1, stream: "stdout" as const, text: `${runId}\n` },
        ],
        firstSequence: 1,
        runId,
        taskId: "build",
        truncated: false,
        version: 1,
      })),
      runsSnapshot: vi.fn(() => ({ runs: {}, version: 0 })),
      subscribeOutput: vi.fn((listener) => {
        outputListener = listener;
        return vi.fn();
      }),
      subscribeRuns: vi.fn(() => vi.fn()),
    } as unknown as TaskService;
    const bindings = createTaskOutputTerminalBindings({ addon, taskService });
    bindings.attach({
      browserWindowId: 7,
      nativePanelId: "7::output",
      params: { label: "Build", runId: "run-1", taskId: "build" },
    });

    expect(
      bindings.rebind({
        nativePanelId: "7::output",
        params: {
          contextId: "ctx-project",
          generation: 1,
          label: "Build",
          projectRootPath: "/project",
          selectedRunId: "run-2",
          taskId: "build",
          version: 2,
        },
      })
    ).toEqual({ ok: false, error: "native terminal output reset failed" });

    outputListener?.({
      chunks: [{ sequence: 2, stream: "stdout", text: "still-old\n" }],
      firstSequence: 1,
      runId: "run-1",
      taskId: "build",
      truncated: false,
      version: 2,
    });
    expect(writes.join("")).toContain("still-old\r\n");
  });

  it("renders an explicit unavailable result after in-memory output is gone", () => {
    const writes: string[] = [];
    const finishTerminalOutput = vi.fn(() => true);
    const addon = {
      finishTerminalOutput,
      writeTerminalOutput: vi.fn((_panelId: string, data: Buffer) => {
        writes.push(data.toString("utf8"));
        return true;
      }),
    } as unknown as NativeAddon;
    const taskService = {
      output: vi.fn(() => null),
      runsSnapshot: vi.fn(() => ({ runs: {}, version: 0 })),
      subscribeOutput: vi.fn(() => vi.fn()),
      subscribeRuns: vi.fn(() => vi.fn()),
    } as unknown as TaskService;
    const bindings = createTaskOutputTerminalBindings({ addon, taskService });

    expect(
      bindings.attach({
        browserWindowId: 7,
        nativePanelId: "7::output",
        params: { label: "Build", runId: "run-old", taskId: "build" },
      })
    ).toEqual({ ok: true });
    expect(writes.join("")).toContain("Task output is no longer available");
    expect(finishTerminalOutput).toHaveBeenCalledWith("7::output", 1, 0);
  });
});
