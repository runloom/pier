import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskOutputKeyDismiss } from "@/panel-kits/terminal/use-task-output-key-dismiss.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";
import { requestTerminalWebFocus } from "@/stores/terminal-input-routing-slice.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

vi.mock("@/stores/terminal-input-routing-slice.ts", () => ({
  requestTerminalWebFocus: vi.fn(() => vi.fn()),
}));

vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppAlert: vi.fn(async () => undefined),
}));

describe("useTaskOutputKeyDismiss", () => {
  beforeEach(() => {
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
    vi.mocked(requestTerminalWebFocus).mockClear();
    vi.mocked(requestTerminalWebFocus).mockReturnValue(vi.fn());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("closes the finished task output panel on any key while active", () => {
    const params = {
      taskOutput: { label: "Build", runId: "run-1", taskId: "build" },
    };
    renderHook(() => useTaskOutputKeyDismiss("panel-1", params, true));

    expect(requestTerminalWebFocus).toHaveBeenCalledWith(
      "task-output-dismiss:panel-1"
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });

    expect(useWorkspaceStore.getState().closePanel).toHaveBeenCalledWith(
      "panel-1"
    );
  });

  it("does not arm dismiss while the run is still active", () => {
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
      useTaskOutputKeyDismiss(
        "panel-1",
        { taskOutput: { label: "Build", runId: "run-1", taskId: "build" } },
        true
      )
    );

    expect(requestTerminalWebFocus).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });
    expect(useWorkspaceStore.getState().closePanel).not.toHaveBeenCalled();
  });
});
