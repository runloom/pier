// @vitest-environment jsdom

import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import type { PluginPanelRegistration } from "@plugins/api/renderer.ts";
import type { TaskRunControlEntry } from "@shared/contracts/tasks.ts";
import { render, screen } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { FileText } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withPluginPanelHostBoundary } from "@/components/workspace/panel-resource-boundary.tsx";
import { initI18n } from "@/i18n/index.ts";
import { useTaskRunControlDismissStore } from "@/stores/task-run-control-dismiss.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";

function gitPanelProps(): IDockviewPanelProps {
  return {
    api: {
      id: "git-current",
      isVisible: true,
      onDidDimensionsChange: () => ({ dispose: () => undefined }),
      onDidVisibilityChange: () => ({ dispose: () => undefined }),
      setTitle: () => undefined,
      title: "pier",
      updateParameters: () => undefined,
    },
    params: {},
  } as unknown as IDockviewPanelProps;
}

function backgroundRunOnGit(): TaskRunControlEntry {
  return {
    mode: "background",
    nodes: {
      "package-script:typecheck": {
        label: "typecheck",
        panelId: "background-task:run-1:package-script:typecheck",
        status: "running",
        taskId: "package-script:typecheck",
      },
    },
    originPanelId: "git-current",
    ownerWindowId: "window-main",
    projectRootPath: "/repo",
    rootTaskId: "package-script:typecheck",
    runId: "run-1",
    startedAt: Date.now() - 8000,
    status: "running",
    updatedAt: Date.now(),
  };
}

describe("panel task runtime overlay", () => {
  beforeEach(async () => {
    await initI18n();
    useTaskRunControlDismissStore.getState().clearForTests();
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: {}, version: 0 },
    });
  });

  afterEach(() => {
    useTaskRunControlDismissStore.getState().clearForTests();
    useTaskRunsStore.setState({
      error: null,
      initialized: false,
      snapshot: { runs: {}, version: 0 },
    });
  });

  it("does not mount runtime control on git when no origin run exists", () => {
    const Panel = withPluginPanelHostBoundary({
      component: () => <div data-testid="git-body">git</div>,
      icon: FileText,
      id: "pier.git.changes",
      kind: "web",
    } as PluginPanelRegistration);

    render(
      <TooltipProvider>
        <Panel {...gitPanelProps()} />
      </TooltipProvider>
    );

    expect(screen.getByTestId("git-body")).toBeTruthy();
    expect(screen.queryByTestId("terminal-runtime-control")).toBeNull();
  });

  it("shows open-output, not reveal, for a background run originated on git", () => {
    const run = backgroundRunOnGit();
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { [run.runId]: run }, version: 1 },
    });
    const Panel = withPluginPanelHostBoundary({
      component: () => <div data-testid="git-body">git</div>,
      icon: FileText,
      id: "pier.git.changes",
      kind: "web",
    } as PluginPanelRegistration);

    render(
      <TooltipProvider>
        <Panel {...gitPanelProps()} />
      </TooltipProvider>
    );

    expect(screen.getByTestId("terminal-runtime-control")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Open task output" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Reveal task terminal" })
    ).toBeNull();
  });
});
