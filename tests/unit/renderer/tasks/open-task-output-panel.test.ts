import type { DockviewApi } from "dockview-react";
import { describe, expect, it, vi } from "vitest";
import {
  maintainTaskOutputPanels,
  openTaskOutputPanel,
  syncTaskOutputPanelsToActiveRuns,
  taskOutputPanelId,
} from "@/components/workspace/open-task-output-panel.ts";

describe("open task output panel", () => {
  it("creates once and activates the existing logical task view", async () => {
    const setActive = vi.fn();
    const panels: Array<{
      api: {
        setActive(): void;
        updateParameters(params: Record<string, unknown>): void;
      };
      id: string;
      params?: unknown;
      view: { contentComponent: string };
    }> = [];
    const addPanel = vi.fn(
      (options: { component: string; id: string; params?: unknown }) => {
        panels.push({
          api: { setActive, updateParameters: vi.fn() },
          id: options.id,
          params: options.params,
          view: { contentComponent: options.component },
        });
      }
    );
    const api = {
      activeGroup: { id: "group-1" },
      addPanel,
      panels,
    } as unknown as DockviewApi;
    const params = {
      contextId: "ctx-project",
      generation: 0,
      label: "Build",
      projectRootPath: "/project",
      selectedRunId: "run-1",
      taskId: "build:all",
      version: 2 as const,
    };

    await expect(openTaskOutputPanel(api, params)).resolves.toEqual({
      ok: true,
    });
    await expect(openTaskOutputPanel(api, params)).resolves.toEqual({
      ok: true,
    });

    expect(addPanel).toHaveBeenCalledTimes(1);
    expect(addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "terminal",
        id: taskOutputPanelId(params),
        params: {
          tab: {
            icon: { id: "pier.task", label: "Task" },
            title: "Build",
          },
          taskOutput: params,
        },
      })
    );
    expect(setActive).toHaveBeenCalledTimes(2);
  });

  it("uses one stable panel id across different runs", () => {
    const first = {
      contextId: "ctx-project",
      generation: 0,
      label: "Build",
      projectRootPath: "/project",
      selectedRunId: "run-1",
      taskId: "build:all",
      version: 2 as const,
    };
    expect(taskOutputPanelId(first)).toBe(
      taskOutputPanelId({ ...first, selectedRunId: "run-2" })
    );
  });

  it("rebinds an existing logical view before committing the new selected run", async () => {
    const updateParameters = vi.fn();
    const setActive = vi.fn();
    const current = {
      contextId: "ctx-project",
      generation: 0,
      label: "Build",
      projectRootPath: "/project",
      selectedRunId: "run-1",
      taskId: "build:all",
      version: 2 as const,
    };
    const panel = {
      api: { setActive, updateParameters },
      id: taskOutputPanelId(current),
      params: { taskOutput: current },
      view: { contentComponent: "terminal" },
    };
    const api = {
      activeGroup: { id: "group-1" },
      addPanel: vi.fn(),
      panels: [panel],
    } as unknown as DockviewApi;
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          rebindTaskOutput: vi.fn(async () => ({ generation: 1, ok: true })),
        },
      },
    });

    await expect(
      openTaskOutputPanel(api, { ...current, selectedRunId: "run-2" })
    ).resolves.toEqual({ ok: true });

    expect(window.pier.terminal.rebindTaskOutput).toHaveBeenCalledWith(
      panel.id,
      expect.objectContaining({ generation: 1, selectedRunId: "run-2" })
    );
    expect(updateParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        taskOutput: expect.objectContaining({ selectedRunId: "run-2" }),
      })
    );
    expect(setActive).toHaveBeenCalledOnce();
  });

  it("reuses and migrates a legacy run-scoped panel in place", async () => {
    const updateParameters = vi.fn();
    const setActive = vi.fn();
    const legacy = { label: "Build", runId: "run-1", taskId: "build:all" };
    const panel = {
      api: { setActive, updateParameters },
      id: taskOutputPanelId(legacy),
      params: { taskOutput: legacy },
      view: { contentComponent: "terminal" },
    };
    const api = {
      activeGroup: { id: "group-1" },
      addPanel: vi.fn(),
      panels: [panel],
    } as unknown as DockviewApi;
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          rebindTaskOutput: vi.fn(async () => ({ generation: 1, ok: true })),
        },
      },
    });

    await expect(
      openTaskOutputPanel(api, {
        contextId: "ctx-project",
        generation: 0,
        label: "Build",
        projectRootPath: "/project",
        selectedRunId: "run-1",
        taskId: "build:all",
        version: 2,
      })
    ).resolves.toEqual({ ok: true });

    expect(api.addPanel).not.toHaveBeenCalled();
    expect(window.pier.terminal.rebindTaskOutput).toHaveBeenCalledWith(
      panel.id,
      expect.objectContaining({
        contextId: "ctx-project",
        generation: 1,
        selectedRunId: "run-1",
        version: 2,
      })
    );
    expect(updateParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        taskOutput: expect.objectContaining({ version: 2 }),
      })
    );
    expect(setActive).toHaveBeenCalledOnce();
  });

  it("rebinds an open logical view when a newer active run appears", async () => {
    const updateParameters = vi.fn();
    const setActive = vi.fn();
    const current = {
      contextId: "ctx-project",
      generation: 0,
      label: "Build",
      projectRootPath: "/project",
      selectedRunId: "run-1",
      taskId: "build:all",
      version: 2 as const,
    };
    const panel = {
      api: { setActive, updateParameters },
      id: taskOutputPanelId(current),
      params: { taskOutput: current },
      view: { contentComponent: "terminal" },
    };
    const api = {
      activeGroup: { id: "group-1" },
      addPanel: vi.fn(),
      panels: [panel],
    } as unknown as DockviewApi;
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          rebindTaskOutput: vi.fn(async () => ({ generation: 1, ok: true })),
        },
      },
    });
    const snapshot = {
      runs: {
        "run-1": {
          mode: "background" as const,
          nodes: {
            "build:all": {
              label: "Build",
              panelId: "task-output-ctx-project-build%3Aall",
              status: "succeeded" as const,
              taskId: "build:all",
            },
          },
          projectRootPath: "/project",
          rootTaskId: "build:all",
          runId: "run-1",
          startedAt: 1,
          status: "succeeded" as const,
          updatedAt: 2,
        },
        "run-2": {
          mode: "background" as const,
          nodes: {
            "build:all": {
              label: "Build",
              panelId: "task-output-ctx-project-build%3Aall",
              status: "running" as const,
              taskId: "build:all",
            },
          },
          projectRootPath: "/project",
          rootTaskId: "build:all",
          runId: "run-2",
          startedAt: 3,
          status: "running" as const,
          updatedAt: 4,
        },
      },
      version: 3,
    };

    await syncTaskOutputPanelsToActiveRuns(api, snapshot);

    expect(window.pier.terminal.rebindTaskOutput).toHaveBeenCalledWith(
      panel.id,
      expect.objectContaining({ generation: 1, selectedRunId: "run-2" })
    );
    expect(updateParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        taskOutput: expect.objectContaining({ selectedRunId: "run-2" }),
      })
    );
  });

  it("does not rebind when only a terminal-tab run is active", async () => {
    const updateParameters = vi.fn();
    const current = {
      contextId: "ctx-project",
      generation: 0,
      label: "Build",
      projectRootPath: "/project",
      selectedRunId: "run-1",
      taskId: "build:all",
      version: 2 as const,
    };
    const panel = {
      api: { setActive: vi.fn(), updateParameters },
      id: taskOutputPanelId(current),
      params: { taskOutput: current },
      view: { contentComponent: "terminal" },
    };
    const api = {
      activeGroup: { id: "group-1" },
      addPanel: vi.fn(),
      panels: [panel],
    } as unknown as DockviewApi;
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          rebindTaskOutput: vi.fn(async () => ({ generation: 1, ok: true })),
        },
      },
    });
    const snapshot = {
      runs: {
        "run-1": {
          mode: "background" as const,
          nodes: {
            "build:all": {
              label: "Build",
              panelId: panel.id,
              status: "succeeded" as const,
              taskId: "build:all",
            },
          },
          projectRootPath: "/project",
          rootTaskId: "build:all",
          runId: "run-1",
          startedAt: 1,
          status: "succeeded" as const,
          updatedAt: 2,
        },
        "run-tab": {
          mode: "terminal-tab" as const,
          nodes: {
            "build:all": {
              label: "Build",
              panelId: "terminal-task",
              status: "running" as const,
              taskId: "build:all",
            },
          },
          projectRootPath: "/project",
          rootTaskId: "build:all",
          runId: "run-tab",
          startedAt: 3,
          status: "running" as const,
          updatedAt: 4,
        },
      },
      version: 4,
    };

    await syncTaskOutputPanelsToActiveRuns(api, snapshot);

    expect(window.pier.terminal.rebindTaskOutput).not.toHaveBeenCalled();
  });

  it("dedupes path-scoped and real-context panels for the same task", async () => {
    const updateParameters = vi.fn();
    const pathPanel = {
      api: { setActive: vi.fn(), updateParameters },
      id: "task-output-path",
      params: {
        taskOutput: {
          contextId: "path:/project",
          generation: 0,
          label: "Build",
          projectRootPath: "/project",
          selectedRunId: "run-1",
          taskId: "build:all",
          version: 2 as const,
        },
      },
      view: { contentComponent: "terminal" },
    };
    const realPanel = {
      api: { setActive: vi.fn(), updateParameters: vi.fn() },
      id: taskOutputPanelId({
        contextId: "ctx-project",
        generation: 0,
        label: "Build",
        projectRootPath: "/project",
        selectedRunId: "run-1",
        taskId: "build:all",
        version: 2,
      }),
      params: {
        context: {
          contextId: "ctx-project",
          projectRootPath: "/project",
          updatedAt: 1,
        },
        taskOutput: {
          contextId: "ctx-project",
          generation: 0,
          label: "Build",
          projectRootPath: "/project",
          selectedRunId: "run-1",
          taskId: "build:all",
          version: 2 as const,
        },
      },
      view: { contentComponent: "terminal" },
    };
    const closePanel = vi.fn(async () => undefined);
    const { useWorkspaceStore } = await import("@/stores/workspace.store.ts");
    useWorkspaceStore.setState({ closePanel } as never);
    const api = {
      activeGroup: { id: "group-1" },
      addPanel: vi.fn(),
      panels: [pathPanel, realPanel],
    } as unknown as DockviewApi;
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          rebindTaskOutput: vi.fn(async () => ({ generation: 1, ok: true })),
        },
      },
    });

    await maintainTaskOutputPanels(api, { runs: {}, version: 1 });

    expect(closePanel).toHaveBeenCalledWith(pathPanel.id);
  });

  it("does not close duplicates when keeper context upgrade rebind fails", async () => {
    const pathPanelA = {
      api: { setActive: vi.fn(), updateParameters: vi.fn() },
      id: "task-output-path-a",
      params: {
        taskOutput: {
          contextId: "path:/project",
          generation: 0,
          label: "Build",
          projectRootPath: "/project",
          selectedRunId: "run-1",
          taskId: "build:all",
          version: 2 as const,
        },
      },
      view: { contentComponent: "terminal" },
    };
    const pathPanelB = {
      api: { setActive: vi.fn(), updateParameters: vi.fn() },
      id: "task-output-path-b",
      params: {
        taskOutput: {
          contextId: "path:/project",
          generation: 0,
          label: "Build",
          projectRootPath: "/project",
          selectedRunId: "run-1",
          taskId: "build:all",
          version: 2 as const,
        },
      },
      view: { contentComponent: "terminal" },
    };
    const contextHintPanel = {
      api: { setActive: vi.fn(), updateParameters: vi.fn() },
      id: "task-output-ctx-hint",
      params: {
        taskOutput: {
          contextId: "ctx-project",
          generation: 0,
          instanceId: "hint",
          label: "Build",
          projectRootPath: "/project",
          selectedRunId: "run-1",
          taskId: "build:all",
          version: 2 as const,
        },
      },
      view: { contentComponent: "terminal" },
    };
    const closePanel = vi.fn(async () => undefined);
    const { useWorkspaceStore } = await import("@/stores/workspace.store.ts");
    useWorkspaceStore.setState({ closePanel } as never);
    const api = {
      activeGroup: { id: "group-1" },
      addPanel: vi.fn(),
      panels: [pathPanelA, pathPanelB, contextHintPanel],
    } as unknown as DockviewApi;
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          rebindTaskOutput: vi.fn(async () => ({
            error: "rebind failed",
            ok: false,
          })),
        },
      },
    });

    const result = await maintainTaskOutputPanels(api, {
      runs: {},
      version: 1,
    });

    expect(result.ok).toBe(false);
    expect(closePanel).not.toHaveBeenCalled();
  });
});
