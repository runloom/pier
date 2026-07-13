import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import {
  TASK_STOP_GRACE_MS,
  type TaskRunControlEntry,
  type TaskStopResult,
} from "@shared/contracts/tasks.ts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
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

interface RunOptions {
  force?: boolean;
  mode?: TaskRunControlEntry["mode"];
}

function run(
  status: TaskRunControlEntry["status"],
  options: RunOptions = {}
): TaskRunControlEntry {
  const mode = options.mode ?? "terminal-tab";
  return {
    mode,
    nodes: {
      test: {
        label: "Test suite",
        panelId:
          mode === "background"
            ? "background-task:run-1:test"
            : "terminal-task",
        status,
        taskId: "test",
        windowId: "window-main",
        ...(status === "stopping" ? { stopRequestedAt: 1000 } : {}),
        ...(options.force ? { termination: "force" as const } : {}),
      },
    },
    ...(mode === "background" ? { originPanelId: "terminal-task" } : {}),
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

function installTasks(tasks: Record<string, unknown>): void {
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: { tasks },
  });
}

function renderControl({
  current,
  now = 3000,
  onDismissRun = vi.fn(),
  runs = [current],
}: {
  current: TaskRunControlEntry;
  now?: number;
  onDismissRun?: (runId: string) => void;
  runs?: readonly TaskRunControlEntry[];
}) {
  const view: ReactElement = (
    <TooltipProvider>
      <TerminalRuntimeControl
        now={now}
        onDismissRun={onDismissRun}
        panelId="terminal-task"
        runs={runs}
      />
    </TooltipProvider>
  );
  return render(view);
}

function expectBefore(first: HTMLElement, second: HTMLElement): void {
  expect(first.compareDocumentPosition(second)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING
  );
}

function workspaceApiWithTerminal() {
  return {
    panels: [
      {
        api: { setActive: vi.fn() },
        id: "terminal-task",
        params: {
          context: {
            contextId: "ctx-repo",
            projectRootPath: "/repo",
            updatedAt: 1000,
          },
        },
        view: { contentComponent: "terminal" },
      },
    ],
  };
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

  it("shows only stop for a pending terminal task", () => {
    const current = run("pending");
    installTasks({});

    renderControl({ current });

    const stop = screen.getByRole("button", { name: "Stop task" });
    expect(stop).toBeEnabled();
    expect(stop).toHaveAttribute("data-variant", "ghost");
    expect(stop.querySelector("svg")).toHaveClass("lucide-square");
    expect(screen.queryByRole("button", { name: "Restart task" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Reveal task terminal" })
    ).toBeNull();
    expect(
      screen.queryByTestId("terminal-runtime-control-more")
    ).not.toBeInTheDocument();
  });

  it("shows direct stop, restart, and reveal for a running terminal task", () => {
    const current = run("running");
    installTasks({});

    renderControl({ current });

    const stop = screen.getByRole("button", { name: "Stop task" });
    const restart = screen.getByRole("button", { name: "Restart task" });
    const reveal = screen.getByRole("button", {
      name: "Reveal task terminal",
    });
    expectBefore(stop, restart);
    expectBefore(restart, reveal);
    expect(
      screen.queryByTestId("terminal-runtime-control-more")
    ).not.toBeInTheDocument();
  });

  it("shows only stop and output for a pending background task", () => {
    const current = run("pending", { mode: "background" });
    installTasks({});

    renderControl({ current });

    const stop = screen.getByRole("button", { name: "Stop task" });
    const output = screen.getByRole("button", { name: "Open task output" });
    expectBefore(stop, output);
    expect(screen.queryByRole("button", { name: "Restart task" })).toBeNull();
    expect(
      screen.queryByTestId("terminal-runtime-control-more")
    ).not.toBeInTheDocument();
  });

  it("shows direct stop, restart, and output for a running background task", () => {
    const current = run("running", { mode: "background" });
    installTasks({});

    renderControl({ current });

    const stop = screen.getByRole("button", { name: "Stop task" });
    const restart = screen.getByRole("button", { name: "Restart task" });
    const output = screen.getByRole("button", { name: "Open task output" });
    expectBefore(stop, restart);
    expectBefore(restart, output);
    expect(
      screen.queryByTestId("terminal-runtime-control-more")
    ).not.toBeInTheDocument();
  });

  it("keeps a disabled spinner in the terminal stop position during grace", () => {
    const current = run("stopping");
    installTasks({});

    renderControl({
      current,
      now: 1000 + TASK_STOP_GRACE_MS - 1,
    });

    const stop = screen.getByRole("button", { name: "Stop task" });
    expect(stop).toBeDisabled();
    expect(stop.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Restart task" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Reveal task terminal" })
    ).toBeVisible();
  });

  it("does not render an empty menu for a stopping background run", () => {
    const current = run("stopping", { mode: "background" });
    installTasks({});

    renderControl({
      current,
      now: 1000 + TASK_STOP_GRACE_MS - 1,
    });

    expect(screen.getByRole("button", { name: "Stop task" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Restart task" })).toBeNull();
    expect(
      screen.queryByTestId("terminal-runtime-control-more")
    ).not.toBeInTheDocument();
  });

  it("uses the destructive force-stop control after the grace period", async () => {
    const current = run("stopping");
    const stop = vi.fn(async () => ({
      failures: [],
      snapshot: { ...current, status: "cancelled" as const },
      status: "force-stopped" as const,
    }));
    installTasks({ stop });
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { [current.runId]: current }, version: 1 },
    });

    renderControl({ current, now: 1000 + TASK_STOP_GRACE_MS });
    const forceStop = screen.getByRole("button", { name: "Force stop" });
    expect(forceStop).toHaveAttribute("data-variant", "destructive");
    expect(forceStop.querySelector("svg")).toHaveClass("lucide-octagon-x");
    fireEvent.click(forceStop);

    await waitFor(() => {
      expect(showAppConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ intent: "destructive", size: "sm" })
      );
      expect(stop).toHaveBeenCalledWith({ force: true, runId: "run-1" });
    });
  });

  it("keeps background output beside destructive force stop", () => {
    const current = run("stopping", { mode: "background" });
    installTasks({});

    renderControl({ current, now: 1000 + TASK_STOP_GRACE_MS });

    const forceStop = screen.getByRole("button", { name: "Force stop" });
    const output = screen.getByRole("button", { name: "Open task output" });
    expect(forceStop).toHaveAttribute("data-variant", "destructive");
    expectBefore(forceStop, output);
    expect(screen.queryByRole("button", { name: "Restart task" })).toBeNull();
    expect(
      screen.queryByTestId("terminal-runtime-control-more")
    ).not.toBeInTheDocument();
  });

  it.each([
    "succeeded",
    "cancelled",
  ] as const)("keeps a direct terminal close action for %s", (status) => {
    const current = run(status);
    const onDismissRun = vi.fn();
    installTasks({});

    renderControl({ current, onDismissRun });

    const restart = screen.getByRole("button", { name: "Restart task" });
    const reveal = screen.getByRole("button", {
      name: "Reveal task terminal",
    });
    const dismiss = screen.getByRole("button", {
      name: "Dismiss task result",
    });
    expectBefore(restart, reveal);
    expectBefore(reveal, dismiss);
    expect(screen.queryByRole("button", { name: "Stop task" })).toBeNull();
    expect(
      screen.queryByTestId("terminal-runtime-control-more")
    ).not.toBeInTheDocument();
    fireEvent.click(dismiss);
    expect(onDismissRun).toHaveBeenCalledWith("run-1");
  });

  it.each([
    "succeeded",
    "cancelled",
  ] as const)("keeps a direct background close action for %s", (status) => {
    const current = run(status, { mode: "background" });
    const onDismissRun = vi.fn();
    installTasks({});

    renderControl({ current, onDismissRun });

    const restart = screen.getByRole("button", { name: "Restart task" });
    const output = screen.getByRole("button", { name: "Open task output" });
    const dismiss = screen.getByRole("button", {
      name: "Dismiss task result",
    });
    expectBefore(restart, output);
    expectBefore(output, dismiss);
    expect(screen.queryByRole("button", { name: "Stop task" })).toBeNull();
    expect(
      screen.queryByTestId("terminal-runtime-control-more")
    ).not.toBeInTheDocument();
    fireEvent.click(dismiss);
    expect(onDismissRun).toHaveBeenCalledWith("run-1");
  });

  it.each([
    ["failed", false],
    ["blocked", false],
    ["cancelled", true],
  ] as const)("keeps a direct close action for persistent %s results", (status, force) => {
    const current = run(status, { force });
    const onDismissRun = vi.fn();
    installTasks({});

    renderControl({ current, onDismissRun });

    const restart = screen.getByRole("button", { name: "Restart task" });
    const reveal = screen.getByRole("button", {
      name: "Reveal task terminal",
    });
    const dismiss = screen.getByRole("button", {
      name: "Dismiss task result",
    });
    expectBefore(restart, reveal);
    expectBefore(reveal, dismiss);
    expect(screen.queryByRole("button", { name: "Stop task" })).toBeNull();
    expect(
      screen.queryByTestId("terminal-runtime-control-more")
    ).not.toBeInTheDocument();
    fireEvent.click(dismiss);
    expect(onDismissRun).toHaveBeenCalledTimes(1);
    expect(onDismissRun).toHaveBeenCalledWith("run-1");
  });

  it.each([
    ["failed", false],
    ["blocked", false],
    ["cancelled", true],
  ] as const)("keeps the background result entry and close action direct for %s", (status, force) => {
    const current = run(status, { force, mode: "background" });
    const onDismissRun = vi.fn();
    installTasks({});

    renderControl({ current, onDismissRun });

    const restart = screen.getByRole("button", { name: "Restart task" });
    const output = screen.getByRole("button", { name: "Open task output" });
    const dismiss = screen.getByRole("button", {
      name: "Dismiss task result",
    });
    expectBefore(restart, output);
    expectBefore(output, dismiss);
    expect(screen.queryByRole("button", { name: "Stop task" })).toBeNull();
    expect(
      screen.queryByTestId("terminal-runtime-control-more")
    ).not.toBeInTheDocument();
    fireEvent.click(dismiss);
    expect(onDismissRun).toHaveBeenCalledTimes(1);
    expect(onDismissRun).toHaveBeenCalledWith("run-1");
  });

  it("restarts a running task once and disables every direct control while pending", async () => {
    const spawnResult = Promise.withResolvers<{
      panelIds: string[];
      primaryPanelId: string;
      runId: string;
      status: "started";
    }>();
    const spawn = vi.fn(() => spawnResult.promise);
    const current = run("running");
    const older = {
      ...run("failed"),
      nodes: {
        older: {
          label: "Older failure",
          panelId: "terminal-task",
          status: "failed" as const,
          taskId: "older",
        },
      },
      rootTaskId: "older",
      runId: "run-older",
    };
    installTasks({ spawn });

    renderControl({ current, runs: [current, older] });
    const selector = screen.getByRole("button", {
      name: "Switch task run, current: Test suite",
    });
    const restart = screen.getByRole("button", { name: "Restart task" });
    fireEvent.click(restart);

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
      expect(selector).toBeDisabled();
      expect(screen.getByRole("button", { name: "Stop task" })).toBeDisabled();
      expect(restart).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Reveal task terminal" })
      ).toBeDisabled();
    });

    fireEvent.click(restart);
    expect(spawn).toHaveBeenCalledTimes(1);

    spawnResult.resolve({
      panelIds: ["terminal-task"],
      primaryPanelId: "terminal-task",
      runId: "run-next",
      status: "started",
    });
    await waitFor(() => expect(selector).toBeEnabled());
  });

  it("opens background output without spawning and dismisses only after success", async () => {
    const current = run("failed", { mode: "background" });
    const spawn = vi.fn();
    const onDismissRun = vi.fn();
    const api = workspaceApiWithTerminal();
    vi.mocked(openTaskOutputPanel)
      .mockResolvedValueOnce({
        code: "rebind_failed",
        message: "not available",
        ok: false,
      })
      .mockResolvedValueOnce({ ok: true });
    installTasks({ spawn });
    useWorkspaceStore.setState({ api: api as never });

    renderControl({ current, onDismissRun });
    const output = screen.getByRole("button", { name: "Open task output" });
    fireEvent.click(output);
    await waitFor(() => expect(openTaskOutputPanel).toHaveBeenCalledTimes(1));
    expect(spawn).not.toHaveBeenCalled();
    expect(onDismissRun).not.toHaveBeenCalled();

    fireEvent.click(output);
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
      expect(onDismissRun).toHaveBeenCalledWith("run-1");
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("dismisses a persistent terminal result after reveal succeeds, not after failure", async () => {
    const current = run("failed");
    const onDismissRun = vi.fn();
    installTasks({});

    renderControl({ current, onDismissRun });
    const reveal = screen.getByRole("button", {
      name: "Reveal task terminal",
    });
    fireEvent.click(reveal);
    await waitFor(() => expect(showAppAlert).toHaveBeenCalled());
    expect(onDismissRun).not.toHaveBeenCalled();

    const api = workspaceApiWithTerminal();
    useWorkspaceStore.setState({ api: api as never });
    fireEvent.click(reveal);
    await waitFor(() => {
      expect(api.panels[0]?.api.setActive).toHaveBeenCalled();
      expect(onDismissRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("dismisses a persistent result after restart succeeds, not after failure", async () => {
    const current = run("failed");
    const onDismissRun = vi.fn();
    const spawn = vi
      .fn()
      .mockResolvedValueOnce({ message: "unsupported", status: "unsupported" })
      .mockResolvedValueOnce({
        panelIds: ["terminal-task"],
        primaryPanelId: "terminal-task",
        runId: "run-next",
        status: "started",
      });
    installTasks({ spawn });

    renderControl({ current, onDismissRun });
    const restart = screen.getByRole("button", { name: "Restart task" });
    fireEvent.click(restart);
    await waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    expect(onDismissRun).not.toHaveBeenCalled();

    fireEvent.click(restart);
    await waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(onDismissRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("requests an ordinary graceful stop", async () => {
    const current = run("running");
    const stop = vi.fn(async () => stopResult(current));
    installTasks({ stop });
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { [current.runId]: current }, version: 1 },
    });

    const { container } = renderControl({ current });
    expect(container.querySelector('[data-slot="badge"]')).toBeNull();
    expect(container.querySelector('[data-slot="separator"]')).not.toBeNull();
    expect(screen.getByText("Test suite")).toHaveClass("flex-1", "truncate");
    expect(
      screen.getByRole("group", { name: "Task run controls: Test suite" })
    ).toHaveClass("w-full");
    expect(screen.getByRole("status", { name: "Running" })).toBeVisible();
    expect(screen.getByLabelText("Elapsed time: 2s")).toHaveTextContent("2s");
    fireEvent.click(screen.getByRole("button", { name: "Stop task" }));

    await waitFor(() => {
      expect(stop).toHaveBeenCalledWith({ force: false, runId: "run-1" });
    });
    expect(showAppConfirm).not.toHaveBeenCalled();
    expect(showAppAlert).not.toHaveBeenCalled();
  });

  it.each([
    ["pending", "Pending", "text-status-info-fg"],
    ["running", "Running", "text-status-info-fg"],
    ["stopping", "Stopping", "text-status-warning-fg"],
    ["succeeded", "Succeeded", "text-status-success-fg"],
    ["failed", "Failed", "text-status-danger-fg"],
    ["blocked", "Blocked", "text-status-warning-fg"],
    ["cancelled", "Cancelled", "text-status-warning-fg"],
  ] as const)("renders the %s status as an icon only", (status, label, color) => {
    const current = run(status);
    installTasks({});

    renderControl({ current });

    const indicator = screen.getByRole("status", { name: label });
    expect(indicator.querySelector("svg")).toHaveClass("size-4", color);
    expect(screen.queryByText(label)).toBeNull();
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
    installTasks({});

    const view = renderControl({ current: failed });
    view.rerender(
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
    const separator = view.container.querySelector<HTMLElement>(
      '[data-slot="separator"]'
    );
    if (!separator) {
      throw new Error("runtime control separator is missing");
    }
    expectBefore(selector, separator);
  });
});
