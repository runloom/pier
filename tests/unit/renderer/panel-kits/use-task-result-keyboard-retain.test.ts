import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskResultKeyboardRetain } from "@/panel-kits/terminal/hooks/use-task-result-keyboard-retain.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";
import {
  resetTerminalEndStateStoreForTests,
  useTerminalEndStateStore,
} from "@/stores/terminal-end-state.store.ts";
import { requestTerminalWebFocus } from "@/stores/terminal-input-routing-slice.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

vi.mock("@/stores/terminal-input-routing-slice.ts", () => ({
  requestTerminalWebFocus: vi.fn(() => vi.fn()),
}));

describe("useTaskResultKeyboardRetain", () => {
  const childExitedListeners: Array<
    (e: { exitCode: number; panelId: string; runtimeMs: number }) => void
  > = [];

  beforeEach(() => {
    childExitedListeners.length = 0;
    useWorkspaceStore.setState({ closePanel: vi.fn(async () => true) });
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: {
        runs: {
          "run-1": {
            mode: "background",
            nodes: {
              build: {
                label: "Build",
                status: "failed",
                taskId: "build",
              },
            },
            originPanelId: "origin",
            ownerWindowId: "win-1",
            projectRootPath: "/repo",
            rootTaskId: "build",
            runId: "run-1",
            startedAt: 1,
            status: "failed",
            updatedAt: 2,
          },
        },
        version: 1,
      },
    });
    vi.stubGlobal("pier", {
      terminal: {
        onChildExited: vi.fn((cb) => {
          childExitedListeners.push(cb);
          return () => {
            const i = childExitedListeners.indexOf(cb);
            if (i >= 0) {
              childExitedListeners.splice(i, 1);
            }
          };
        }),
      },
    });
    vi.mocked(requestTerminalWebFocus).mockClear();
    vi.mocked(requestTerminalWebFocus).mockReturnValue(vi.fn());
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    resetTerminalEndStateStoreForTests();
  });

  it("pins web focus for finished task output without closing the panel", () => {
    const params = {
      taskOutput: { label: "Build", runId: "run-1", taskId: "build" },
    };
    const sink = document.createElement("div");
    sink.tabIndex = -1;
    document.body.append(sink);
    const focusSpy = vi.spyOn(sink, "focus");
    const sinkRef = { current: sink };

    renderHook(() =>
      useTaskResultKeyboardRetain("panel-1", params, true, sinkRef)
    );

    expect(requestTerminalWebFocus).toHaveBeenCalledWith(
      "task-result-retain:panel-1"
    );
    expect(focusSpy).toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });

    expect(useWorkspaceStore.getState().closePanel).not.toHaveBeenCalled();
    sink.remove();
  });

  it("does not pin focus while the run is still active", () => {
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: {
        runs: {
          "run-1": {
            mode: "background",
            nodes: {
              build: {
                label: "Build",
                status: "running",
                taskId: "build",
              },
            },
            originPanelId: "origin",
            ownerWindowId: "win-1",
            projectRootPath: "/repo",
            rootTaskId: "build",
            runId: "run-1",
            startedAt: 1,
            status: "running",
            updatedAt: 2,
          },
        },
        version: 1,
      },
    });

    renderHook(() =>
      useTaskResultKeyboardRetain(
        "panel-1",
        { taskOutput: { label: "Build", runId: "run-1", taskId: "build" } },
        true
      )
    );

    expect(requestTerminalWebFocus).not.toHaveBeenCalled();
  });

  it("pins focus after child-exited even before run snapshot settles", () => {
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: {}, version: 1 },
    });

    renderHook(() =>
      useTaskResultKeyboardRetain(
        "task-output-1",
        { taskOutput: { label: "Build", runId: "run-1", taskId: "build" } },
        true
      )
    );

    expect(requestTerminalWebFocus).not.toHaveBeenCalled();

    act(() => {
      for (const cb of childExitedListeners) {
        cb({ exitCode: 0, panelId: "task-output-1", runtimeMs: 1000 });
      }
    });

    expect(requestTerminalWebFocus).toHaveBeenCalledWith(
      "task-result-retain:task-output-1"
    );
  });

  it("pins focus when EndState exists even without child-exited latch", () => {
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: {}, version: 1 },
    });
    act(() => {
      useTerminalEndStateStore.getState().upsertAgentEnd({
        agentId: "claude",
        exitCode: 0,
        panelId: "terminal-agent-1",
      });
    });

    renderHook(() =>
      useTaskResultKeyboardRetain("terminal-agent-1", undefined, true)
    );

    expect(requestTerminalWebFocus).toHaveBeenCalledWith(
      "task-result-retain:terminal-agent-1"
    );
  });
});
