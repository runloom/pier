import type { TaskRunControlEntry } from "@shared/contracts/tasks.ts";
import type { DockviewApi } from "dockview-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  rebindOpenTaskOutputsAfterRestart,
  requestTaskOutputSurfaceClose,
} from "@/lib/actions/task-output-run-operations.ts";
import {
  resolveTaskRunActionTarget,
  restartTaskRun,
  taskRunActionTargetFromRun,
} from "@/lib/actions/task-run-operations.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { useAppDialogStore } from "@/stores/app-dialog.store.ts";
import { useTaskRunSelectionStore } from "@/stores/task-run-selection.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function taskRun(
  runId: string,
  panelId: string,
  mode: TaskRunControlEntry["mode"] = "terminal-tab"
): TaskRunControlEntry {
  return {
    mode,
    nodes: {
      test: {
        label: "Test suite",
        panelId,
        status: "running",
        taskId: "test",
      },
    },
    ...(mode === "background" ? { originPanelId: "terminal-origin" } : {}),
    projectRootPath: "/repo",
    rootTaskId: "test",
    runId,
    startedAt: 100,
    status: "running",
    updatedAt: 200,
  };
}

function taskPanel(id: string, runId = "run-old") {
  return {
    id,
    params: {
      task: {
        cwd: "/repo",
        label: "Test suite",
        projectRootPath: "/repo",
        rawCommand: "pnpm test",
        runId,
        source: "package-script",
        startedAt: 100,
        status: "running",
        taskId: "test",
      },
    },
    title: "Test suite",
    view: { contentComponent: "terminal" },
  };
}

function outputPanel(id: string, runId: string) {
  return {
    api: {
      setActive: vi.fn(),
      updateParameters: vi.fn(),
    },
    id,
    params: {
      taskOutput: { label: "Test output", runId, taskId: "test" },
    },
    title: "Test output",
    view: { contentComponent: "terminal" },
  };
}

function installApi(activePanel: object, panels: object[]): void {
  useWorkspaceStore.getState().setApi({
    activePanel,
    groups: [],
    panels,
  } as unknown as DockviewApi);
}

describe("task run operations", () => {
  beforeEach(async () => {
    await initI18n();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        tasks: {
          spawn: vi.fn(async () => ({
            panelIds: ["terminal-origin"],
            primaryPanelId: "terminal-origin",
            runId: "run-new",
            status: "started" as const,
          })),
        },
        terminal: {
          rebindTaskOutput: vi.fn(async () => ({
            generation: 1,
            ok: true,
          })),
        },
      },
    });
  });

  afterEach(() => {
    useTaskRunSelectionStore.setState({ selectedRunIdsByPanel: {} });
    useWorkspaceStore.getState().setApi(null);
    useTaskRunsStore.setState({
      error: null,
      initialized: false,
      snapshot: { runs: {}, version: 0 },
    });
    const dialog = useAppDialogStore.getState().current;
    if (dialog?.kind === "alert") {
      dialog.resolve(false);
    }
    vi.restoreAllMocks();
  });

  it("resolves the current panel run instead of stale task params", () => {
    const panel = taskPanel("terminal-task");
    const current = taskRun("run-current", "terminal-task");
    installApi(panel, [panel]);
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { [current.runId]: current }, version: 1 },
    });

    expect(resolveTaskRunActionTarget()).toMatchObject({
      panelId: "terminal-task",
      runId: "run-current",
      taskId: "test",
    });
  });

  it("uses the context-menu source panel instead of a later active panel", () => {
    const active = taskPanel("terminal-active", "run-active");
    const source = taskPanel("terminal-source", "run-source");
    const activeRun = taskRun("run-active", "terminal-active");
    const sourceRun = taskRun("run-source", "terminal-source");
    installApi(active, [active, source]);
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: {
        runs: {
          [activeRun.runId]: activeRun,
          [sourceRun.runId]: sourceRun,
        },
        version: 1,
      },
    });

    expect(
      resolveTaskRunActionTarget({ sourcePanelId: "terminal-source" })
    ).toMatchObject({ panelId: "terminal-source", runId: "run-source" });
  });

  it("keeps a task panel bound to its owning run when a newer background run shares the origin", () => {
    const panel = taskPanel("terminal-task", "run-panel");
    const panelRun = taskRun("run-panel", "terminal-task");
    const backgroundRun = {
      ...taskRun("run-background", "background-task", "background"),
      originPanelId: "terminal-task",
      updatedAt: panelRun.updatedAt + 100,
    };
    installApi(panel, [panel]);
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: {
        runs: {
          [backgroundRun.runId]: backgroundRun,
          [panelRun.runId]: panelRun,
        },
        version: 2,
      },
    });

    expect(resolveTaskRunActionTarget()).toMatchObject({
      mode: "terminal-tab",
      panelId: "terminal-task",
      runId: "run-panel",
    });
  });

  it("uses the runtime-control selection when another owned run still looks active", () => {
    const panel = taskPanel("terminal-task", "run-cancelled");
    const cancelledRun = taskRun("run-cancelled", "terminal-task");
    cancelledRun.status = "cancelled";
    const cancelledNode = cancelledRun.nodes.test;
    if (!cancelledNode) {
      throw new Error("missing cancelled run node");
    }
    cancelledNode.status = "cancelled";
    const staleActiveRun = {
      ...taskRun("run-stale-active", "terminal-task"),
      updatedAt: cancelledRun.updatedAt - 100,
    };
    installApi(panel, [panel]);
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: {
        runs: {
          [cancelledRun.runId]: cancelledRun,
          [staleActiveRun.runId]: staleActiveRun,
        },
        version: 3,
      },
    });
    useTaskRunSelectionStore
      .getState()
      .selectPanelRun("terminal-task", "run-cancelled");

    expect(resolveTaskRunActionTarget()).toMatchObject({
      panelId: "terminal-task",
      runId: "run-cancelled",
    });
  });

  it("restarts a task output panel through its background origin", async () => {
    const origin = {
      id: "terminal-origin",
      params: {
        context: {
          contextId: "ctx-repo",
          projectRootPath: "/repo",
          updatedAt: 100,
        },
      },
    };
    const output = outputPanel("task-output-run-1-test", "run-1");
    const current = taskRun("run-1", "background-task", "background");
    installApi(output, [origin, output]);
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { [current.runId]: current }, version: 1 },
    });

    const target = resolveTaskRunActionTarget();
    expect(target).not.toBeNull();
    if (!target) {
      return;
    }
    await expect(restartTaskRun(target)).resolves.toEqual({
      panelRebound: true,
      runId: "run-new",
    });

    expect(window.pier.tasks.spawn).toHaveBeenCalledWith({
      focus: false,
      forceRestart: true,
      mode: "background",
      placement: "active-tab",
      projectRootPath: "/repo",
      taskId: "test",
      terminalPanelId: "terminal-origin",
    });
    expect(window.pier.terminal.rebindTaskOutput).toHaveBeenCalledWith(
      "task-output-run-1-test",
      expect.objectContaining({
        contextId: "ctx-repo",
        generation: 1,
        projectRootPath: "/repo",
        selectedRunId: "run-new",
        version: 2,
      })
    );
    expect(output.api.updateParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        taskOutput: expect.objectContaining({ selectedRunId: "run-new" }),
      })
    );
  });

  it("rebinds an open output panel when restart starts from the origin runtime control", async () => {
    const origin = {
      id: "terminal-origin",
      params: {
        context: {
          contextId: "ctx-repo",
          projectRootPath: "/repo",
          updatedAt: 100,
        },
      },
      view: { contentComponent: "terminal" },
    };
    const output = outputPanel("task-output-run-1-test", "run-1");
    const current = taskRun("run-1", "background-task", "background");
    installApi(origin, [origin, output]);

    const target = taskRunActionTargetFromRun(
      current,
      "terminal-origin",
      "Test output"
    );
    await expect(restartTaskRun(target)).resolves.toEqual({
      panelRebound: true,
      runId: "run-new",
    });

    expect(window.pier.tasks.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "background",
        taskId: "test",
        terminalPanelId: "terminal-origin",
      })
    );
    expect(window.pier.terminal.rebindTaskOutput).toHaveBeenCalledWith(
      "task-output-run-1-test",
      expect.objectContaining({
        contextId: "ctx-repo",
        generation: 1,
        selectedRunId: "run-new",
        taskId: "test",
      })
    );
    expect(output.api.updateParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        taskOutput: expect.objectContaining({ selectedRunId: "run-new" }),
      })
    );
  });

  it("defers an output surface close during restart and discards it after rebind", async () => {
    const origin = {
      id: "terminal-origin",
      params: {
        context: {
          contextId: "ctx-repo",
          projectRootPath: "/repo",
          updatedAt: 100,
        },
      },
      view: { contentComponent: "terminal" },
    };
    const output = outputPanel("task-output-run-1-test", "run-1");
    const current = taskRun("run-1", "background-task", "background");
    const spawn = Promise.withResolvers<{
      panelIds: string[];
      primaryPanelId: string;
      runId: string;
      status: "started";
    }>();
    installApi(origin, [origin, output]);
    vi.mocked(window.pier.tasks.spawn).mockReturnValue(spawn.promise);

    const restart = restartTaskRun(
      taskRunActionTargetFromRun(current, "terminal-origin", "Test output")
    );
    await vi.waitFor(() => {
      expect(window.pier.tasks.spawn).toHaveBeenCalledTimes(1);
    });
    const close = vi.fn();
    requestTaskOutputSurfaceClose(output.id, close);
    expect(close).not.toHaveBeenCalled();

    spawn.resolve({
      panelIds: ["terminal-origin"],
      primaryPanelId: "terminal-origin",
      runId: "run-new",
      status: "started",
    });
    await expect(restart).resolves.toEqual({
      panelRebound: true,
      runId: "run-new",
    });
    expect(close).not.toHaveBeenCalled();
  });

  it.each([
    ["unsupported", { message: "unsupported", status: "unsupported" as const }],
    ["failed", new Error("spawn failed")],
  ])("releases a deferred output surface close when restart is %s", async (_case, outcome) => {
    const origin = {
      id: "terminal-origin",
      params: {
        context: {
          contextId: "ctx-repo",
          projectRootPath: "/repo",
          updatedAt: 100,
        },
      },
      view: { contentComponent: "terminal" },
    };
    const output = outputPanel("task-output-run-1-test", "run-1");
    const current = taskRun("run-1", "background-task", "background");
    const spawn = Promise.withResolvers<
      { message: string; status: "unsupported" } | never
    >();
    installApi(origin, [origin, output]);
    vi.mocked(window.pier.tasks.spawn).mockReturnValue(spawn.promise);

    const restart = restartTaskRun(
      taskRunActionTargetFromRun(current, "terminal-origin", "Test output")
    );
    await vi.waitFor(() => {
      expect(window.pier.tasks.spawn).toHaveBeenCalledTimes(1);
    });
    const close = vi.fn();
    requestTaskOutputSurfaceClose(output.id, close);
    expect(close).not.toHaveBeenCalled();

    if (outcome instanceof Error) {
      spawn.reject(outcome);
    } else {
      spawn.resolve(outcome);
    }
    await vi.waitFor(() => {
      expect(useAppDialogStore.getState().current?.kind).toBe("alert");
    });
    const alert = useAppDialogStore.getState().current;
    if (alert?.kind !== "alert") {
      throw new Error("expected restart failure alert");
    }
    alert.resolve(false);
    await expect(restart).resolves.toBeNull();
    expect(close).toHaveBeenCalledOnce();
  });

  it("rolls back earlier output views when a later rebind fails", async () => {
    const origin = {
      id: "terminal-origin",
      params: {
        context: {
          contextId: "ctx-repo",
          projectRootPath: "/repo",
          updatedAt: 100,
        },
      },
      view: { contentComponent: "terminal" },
    };
    const first = outputPanel("task-output-first", "run-1");
    const second = outputPanel("task-output-second", "run-1");
    const current = taskRun("run-1", "background-task", "background");
    installApi(origin, [origin, first, second]);
    vi.mocked(window.pier.terminal.rebindTaskOutput)
      .mockResolvedValueOnce({ generation: 1, ok: true })
      .mockResolvedValueOnce({ error: "second failed", ok: false })
      .mockResolvedValueOnce({ generation: 2, ok: true });

    await expect(
      rebindOpenTaskOutputsAfterRestart({
        previousRun: current,
        runId: "run-new",
      })
    ).resolves.toMatchObject({ error: "second failed", ok: false });

    expect(window.pier.terminal.rebindTaskOutput).toHaveBeenCalledTimes(3);
    expect(window.pier.terminal.rebindTaskOutput).toHaveBeenNthCalledWith(
      3,
      "task-output-first",
      expect.objectContaining({ generation: 2, selectedRunId: "run-1" })
    );
  });

  it("collects required inputs before restarting a terminal task", async () => {
    const panel = taskPanel("terminal-task", "run-1");
    const current = taskRun("run-1", "terminal-task");
    installApi(panel, [panel]);
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { [current.runId]: current }, version: 1 },
    });
    vi.mocked(window.pier.tasks.spawn)
      .mockResolvedValueOnce({
        inputs: [
          {
            default: "local",
            description: "Environment",
            id: "environment",
            type: "promptString",
          },
        ],
        status: "requires-input",
      })
      .mockResolvedValueOnce({
        panelIds: ["terminal-task"],
        primaryPanelId: "terminal-task",
        runId: "run-input",
        status: "started",
      });

    const target = resolveTaskRunActionTarget();
    expect(target).not.toBeNull();
    if (!target) {
      return;
    }

    const restart = restartTaskRun(target);
    await vi.waitFor(() => {
      expect(
        useCommandPaletteController.getState().quickPick?.onAcceptQuery
      ).toBeTypeOf("function");
    });
    useCommandPaletteController
      .getState()
      .quickPick?.onAcceptQuery?.("staging");

    await expect(restart).resolves.toEqual({
      panelRebound: true,
      runId: "run-input",
    });
    expect(window.pier.tasks.spawn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        inputs: { environment: "staging" },
        terminalPanelId: "terminal-task",
      })
    );
  });

  it("does not reuse a task output viewer as the execution terminal", async () => {
    const output = outputPanel("task-output-run-1-test", "run-1");
    const current = taskRun("run-1", "terminal-original");
    installApi(output, [output]);
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { [current.runId]: current }, version: 1 },
    });

    const target = resolveTaskRunActionTarget();
    expect(target).not.toBeNull();
    if (!target) {
      return;
    }
    await restartTaskRun(target);

    expect(window.pier.tasks.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ terminalPanelId: "terminal-original" })
    );
    expect(window.pier.tasks.spawn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        terminalPanelId: "task-output-run-1-test",
      })
    );
  });

  it("deduplicates concurrent restart requests for the same panel", async () => {
    const panel = taskPanel("terminal-task", "run-1");
    const current = taskRun("run-1", "terminal-task");
    installApi(panel, [panel]);
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { [current.runId]: current }, version: 1 },
    });
    const pending = Promise.withResolvers<{
      panelIds: string[];
      primaryPanelId: string;
      runId: string;
      status: "started";
    }>();
    vi.mocked(window.pier.tasks.spawn).mockReturnValue(pending.promise);
    const target = resolveTaskRunActionTarget();
    expect(target).not.toBeNull();
    if (!target) {
      return;
    }

    const first = restartTaskRun(target);
    const second = restartTaskRun(target);
    expect(second).toBe(first);
    expect(window.pier.tasks.spawn).toHaveBeenCalledTimes(1);

    pending.resolve({
      panelIds: ["terminal-task"],
      primaryPanelId: "terminal-task",
      runId: "run-next",
      status: "started",
    });
    await expect(first).resolves.toEqual({
      panelRebound: true,
      runId: "run-next",
    });
    await expect(second).resolves.toEqual({
      panelRebound: true,
      runId: "run-next",
    });
  });

  it("deduplicates the same run across different control panels", async () => {
    const current = taskRun("run-1", "terminal-task");
    const pending = Promise.withResolvers<{
      panelIds: string[];
      primaryPanelId: string;
      runId: string;
      status: "started";
    }>();
    vi.mocked(window.pier.tasks.spawn).mockReturnValue(pending.promise);
    const terminalTarget = taskRunActionTargetFromRun(
      current,
      "terminal-task",
      "Test"
    );
    const outputTarget = {
      ...terminalTarget,
      panelId: "task-output-view",
    };

    const first = restartTaskRun(terminalTarget);
    const second = restartTaskRun(outputTarget);

    expect(second).toBe(first);
    expect(window.pier.tasks.spawn).toHaveBeenCalledTimes(1);
    pending.resolve({
      panelIds: ["terminal-task"],
      primaryPanelId: "terminal-task",
      runId: "run-next",
      status: "started",
    });
    await expect(first).resolves.toMatchObject({ runId: "run-next" });
  });
});
