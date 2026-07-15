import type { DockviewApi } from "dockview-react";
import { describe, expect, it, vi } from "vitest";
import { syncTaskPanelParams } from "@/lib/workspace/task-panel-params-sync.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

describe("syncTaskPanelParams", () => {
  it("writes relaunched task metadata back into dockview params", () => {
    const updateParameters = vi.fn();
    const panel = {
      api: { updateParameters },
      id: "terminal-task",
      params: {
        task: {
          cwd: "/repo",
          label: "Old",
          projectRootPath: "/repo",
          rawCommand: "pnpm test",
          runId: "run-old",
          source: "package-script",
          startedAt: 1,
          status: "running",
          taskId: "test",
        },
      },
    };
    useWorkspaceStore.setState({
      api: { panels: [panel] } as unknown as DockviewApi,
    });
    const nextTask = {
      cwd: "/repo",
      label: "New",
      projectRootPath: "/repo",
      rawCommand: "pnpm test",
      runId: "run-new",
      source: "package-script" as const,
      startedAt: 2,
      status: "running" as const,
      taskId: "test",
    };

    syncTaskPanelParams("terminal-task", { task: nextTask });

    expect(updateParameters).toHaveBeenCalledWith(
      expect.objectContaining({ task: nextTask })
    );
  });
});
