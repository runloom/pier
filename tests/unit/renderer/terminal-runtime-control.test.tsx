import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import type {
  TaskRunControlEntry,
  TaskStopResult,
} from "@shared/contracts/tasks.ts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTaskOutputPanel } from "@/components/workspace/open-task-output-panel.ts";
import { initI18n } from "@/i18n/index.ts";
import { TerminalRuntimeControl } from "@/panel-kits/terminal/terminal-runtime-control.tsx";
import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";
import { useTaskRunSelectionStore } from "@/stores/task-run-selection.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

vi.mock("@/components/workspace/open-task-output-panel.ts", () => ({
  openTaskOutputPanel: vi.fn(() => ({ ok: true })),
}));

vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppAlert: vi.fn(async () => undefined),
  showAppConfirm: vi.fn(async () => true),
}));

function run(status: TaskRunControlEntry["status"]): TaskRunControlEntry {
  return {
    mode: "terminal-tab",
    nodes: {
      test: {
        label: "Test suite",
        panelId: "terminal-task",
        status,
        taskId: "test",
        windowId: "window-main",
        ...(status === "stopping" ? { stopRequestedAt: 1000 } : {}),
      },
    },
    ownerWindowId: "window-main",
    projectRootPath: "/repo",
    rootTaskId: "test",
    runId: "run-1",
    startedAt: 500,
    status,
    updatedAt: 1000,
  };
}

function stopResult(snapshot: TaskRunControlEntry): TaskStopResult {
  return { failures: [], snapshot, status: "stopping" };
}

describe("terminal runtime control", () => {
  beforeEach(async () => {
    await initI18n();
    vi.spyOn(Date, "now").mockReturnValue(3000);
    vi.clearAllMocks();
    useTaskRunSelectionStore.setState({ selectedRunIdsByPanel: {} });
  });

  afterEach(() => {
    useTaskRunSelectionStore.setState({ selectedRunIdsByPanel: {} });
    useTaskRunsStore.setState({
      error: null,
      initialized: false,
      snapshot: { runs: {}, version: 0 },
    });
    useWorkspaceStore.setState({ api: null, hasMaximizedGroup: false });
    vi.restoreAllMocks();
  });

  it("requests a graceful stop for a running task", async () => {
    const current = run("running");
    const stop = vi.fn(async () => stopResult(current));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { tasks: { stop } },
    });
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { [current.runId]: current }, version: 1 },
    });

    const { container } = render(
      <TooltipProvider>
        <TerminalRuntimeControl
          now={3000}
          onDismissRun={vi.fn()}
          panelId="terminal-task"
          runs={[current]}
        />
      </TooltipProvider>
    );
    expect(container.querySelector('[data-slot="badge"]')).toBeNull();
    expect(container.querySelector('[data-slot="separator"]')).not.toBeNull();
    expect(screen.getByText("Test suite")).toHaveClass("flex-1", "truncate");
    expect(
      screen.getByRole("group", { name: "Task run controls: Test suite" })
    ).toHaveClass("w-full");
    const statusIcon = screen
      .getByRole("status", { name: "Running" })
      .querySelector("svg");
    expect(statusIcon).not.toBeNull();
    expect(statusIcon).toHaveClass("size-4", "text-status-info-fg");
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Elapsed time: 2s")).toHaveTextContent("2s");
    const stopButton = screen.getByRole("button", { name: "Stop task" });
    expect(stopButton).toHaveAttribute("data-size", "icon-sm");
    expect(stopButton).toHaveAttribute("data-tone", "default");
    expect(stopButton).toHaveAttribute("data-variant", "ghost");
    expect(stopButton).not.toHaveClass("text-action-danger");
    expect(stopButton).not.toHaveClass("bg-destructive/10");
    expect(stopButton.querySelector("svg")).toHaveAttribute("fill", "none");
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(stop).toHaveBeenCalledWith({ force: false, runId: "run-1" });
    });
    expect(showAppConfirm).not.toHaveBeenCalled();
    expect(showAppAlert).not.toHaveBeenCalled();
  });

  it("restarts a terminal task in the current panel", async () => {
    const current = run("running");
    const spawn = vi.fn(async () => ({
      panelIds: ["terminal-task"],
      primaryPanelId: "terminal-task",
      runId: "run-next",
      status: "started" as const,
    }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { tasks: { spawn } },
    });
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { [current.runId]: current }, version: 1 },
    });

    render(
      <TooltipProvider>
        <TerminalRuntimeControl
          now={3000}
          onDismissRun={vi.fn()}
          panelId="terminal-task"
          runs={[current]}
        />
      </TooltipProvider>
    );
    const restartButton = screen.getByRole("button", { name: "Restart task" });
    expect(restartButton).toHaveAttribute("data-tone", "default");
    expect(restartButton).toHaveAttribute("data-variant", "ghost");
    expect(restartButton).not.toHaveClass("text-action-accent");
    fireEvent.click(restartButton);

    await waitFor(() => {
      expect(spawn).toHaveBeenCalledWith({
        focus: true,
        forceRestart: true,
        mode: "terminal-tab",
        placement: "active-tab",
        projectRootPath: "/repo",
        taskId: "test",
        terminalPanelId: "terminal-task",
      });
    });
  });

  it("opens background output without spawning the task again", async () => {
    const current: TaskRunControlEntry = {
      ...run("failed"),
      mode: "background",
      nodes: {
        test: {
          label: "Test suite",
          panelId: "background-task:run-1:test",
          status: "failed",
          taskId: "test",
          windowId: "window-main",
        },
      },
      originPanelId: "terminal-task",
    };
    const spawn = vi.fn();
    const onDismissRun = vi.fn();
    const api = {
      panels: [
        {
          id: "terminal-task",
          params: {
            context: {
              contextId: "ctx-repo",
              projectRootPath: "/repo",
              updatedAt: 1000,
            },
          },
        },
      ],
    } as unknown as NonNullable<
      ReturnType<typeof useWorkspaceStore.getState>["api"]
    >;
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { tasks: { spawn } },
    });
    useWorkspaceStore.setState({ api });
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { [current.runId]: current }, version: 1 },
    });

    render(
      <TooltipProvider>
        <TerminalRuntimeControl
          now={3000}
          onDismissRun={onDismissRun}
          panelId="terminal-task"
          runs={[current]}
        />
      </TooltipProvider>
    );
    const openOutputButton = screen.getByRole("button", {
      name: "Open task output",
    });
    expect(openOutputButton).toHaveAttribute("data-tone", "default");
    expect(openOutputButton).toHaveAttribute("data-variant", "ghost");
    expect(openOutputButton).not.toHaveClass("text-action-accent");
    fireEvent.click(openOutputButton);

    await waitFor(() => {
      expect(openTaskOutputPanel).toHaveBeenCalledWith(api, {
        contextId: "ctx-repo",
        generation: 0,
        label: "Test suite",
        projectRootPath: "/repo",
        selectedRunId: "run-1",
        taskId: "test",
        version: 2,
      });
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(onDismissRun).toHaveBeenCalledWith("run-1");
  });

  it("confirms force stop after the grace period", async () => {
    const current = run("stopping");
    const stop = vi.fn(async () => ({
      failures: [],
      snapshot: { ...current, status: "cancelled" as const },
      status: "force-stopped" as const,
    }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { tasks: { stop } },
    });
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { [current.runId]: current }, version: 1 },
    });

    const { container } = render(
      <TooltipProvider>
        <TerminalRuntimeControl
          now={3000}
          onDismissRun={vi.fn()}
          panelId="terminal-task"
          runs={[current]}
        />
      </TooltipProvider>
    );
    const forceStopButton = screen.getByRole("button", { name: "Force stop" });
    expect(forceStopButton).toHaveAttribute("data-tone", "default");
    expect(forceStopButton).toHaveAttribute("data-variant", "ghost");
    expect(forceStopButton.querySelector("svg")).toHaveClass(
      "lucide-octagon-x"
    );
    expect(forceStopButton.querySelector("svg")).toHaveAttribute(
      "fill",
      "none"
    );
    expect(container.querySelector('[role="status"] svg')).not.toBeNull();
    fireEvent.click(forceStopButton);

    await waitFor(() => {
      expect(showAppConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ intent: "destructive", size: "sm" })
      );
      expect(stop).toHaveBeenCalledWith({ force: true, runId: "run-1" });
    });
  });

  it.each([
    ["pending", "Pending", "text-status-info-fg"],
    ["running", "Running", "text-status-info-fg"],
    ["stopping", "Stopping", "text-status-warning-fg"],
    ["succeeded", "Succeeded", "text-status-success-fg"],
    ["failed", "Failed", "text-status-danger-fg"],
    ["blocked", "Blocked", "text-status-warning-fg"],
    ["cancelled", "Cancelled", "text-status-warning-fg"],
  ] as const)("renders the %s status as an icon only", (status, label, colorClassName) => {
    const current = run(status);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { tasks: {} },
    });

    render(
      <TooltipProvider>
        <TerminalRuntimeControl
          now={3000}
          onDismissRun={vi.fn()}
          panelId="terminal-task"
          runs={[current]}
        />
      </TooltipProvider>
    );

    const statusIndicator = screen.getByRole("status", { name: label });
    expect(statusIndicator).toBeVisible();
    const icon = statusIndicator.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveClass("size-4", colorClassName);
    expect(screen.queryByText(label)).toBeNull();
  });

  it("keeps a failed result actionable until it is explicitly dismissed", () => {
    const current = run("failed");
    const onDismissRun = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { tasks: {} },
    });

    render(
      <TooltipProvider>
        <TerminalRuntimeControl
          now={3000}
          onDismissRun={onDismissRun}
          panelId="terminal-task"
          runs={[current]}
        />
      </TooltipProvider>
    );

    expect(screen.getByRole("status", { name: "Failed" })).toBeVisible();
    expect(screen.queryByText("Failed")).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop task" })).toBeNull();
    const dismissButton = screen.getByRole("button", {
      name: "Dismiss task result",
    });
    expect(dismissButton).toHaveAttribute("data-tone", "default");
    fireEvent.click(dismissButton);
    expect(onDismissRun).toHaveBeenCalledWith("run-1");
  });

  it("moves selection to a newly active run without hiding older failures", async () => {
    const failed = run("failed");
    const active: TaskRunControlEntry = {
      ...run("running"),
      nodes: {
        active: {
          label: "Active build",
          panelId: "terminal-task",
          status: "running",
          taskId: "active",
        },
      },
      rootTaskId: "active",
      runId: "run-2",
    };
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { tasks: {} },
    });

    const { container, rerender } = render(
      <TooltipProvider>
        <TerminalRuntimeControl
          now={3000}
          onDismissRun={vi.fn()}
          panelId="terminal-task"
          runs={[failed]}
        />
      </TooltipProvider>
    );
    rerender(
      <TooltipProvider>
        <TerminalRuntimeControl
          now={3000}
          onDismissRun={vi.fn()}
          panelId="terminal-task"
          runs={[active, failed]}
        />
      </TooltipProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Active build")).toBeVisible();
      expect(
        useTaskRunSelectionStore.getState().selectedRunIdsByPanel[
          "terminal-task"
        ]
      ).toBe("run-2");
    });
    const selector = screen.getByRole("button", {
      name: "Switch task run, current: Active build",
    });
    expect(selector).toBeVisible();
    expect(selector).toHaveAttribute("data-slot", "dropdown-menu-trigger");
    const separator = container.querySelector<HTMLElement>(
      '[data-slot="separator"]'
    );
    if (!separator) {
      throw new Error("runtime control separator is missing");
    }
    expect(selector.compareDocumentPosition(separator)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });
});
