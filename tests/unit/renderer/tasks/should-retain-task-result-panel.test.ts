import type { TaskRunControlEntry } from "@shared/contracts/tasks.ts";
import { afterEach, describe, expect, it } from "vitest";
import { shouldRetainTaskResultPanel } from "@/panel-kits/terminal/should-retain-task-result-panel.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";
import {
  resetTerminalEndStateStoreForTests,
  useTerminalEndStateStore,
} from "@/stores/terminal-end-state.store.ts";

afterEach(() => {
  useTaskRunsStore.setState({
    error: null,
    initialized: false,
    snapshot: { runs: {}, version: 0 },
  });
  resetTerminalEndStateStoreForTests();
});

describe("shouldRetainTaskResultPanel", () => {
  it("retains task-output panel ids", () => {
    expect(
      shouldRetainTaskResultPanel("task-output-ctx-build", undefined)
    ).toBe(true);
  });

  it("retains panels with task params", () => {
    expect(
      shouldRetainTaskResultPanel("terminal-1", {
        task: {
          cwd: "/repo",
          label: "Test",
          projectRootPath: "/repo",
          rawCommand: "pnpm test",
          runId: "run-1",
          source: "package-script",
          startedAt: 1,
          status: "succeeded",
          taskId: "package-script:test",
        },
      })
    ).toBe(true);
  });

  it("retains panels still bound in TaskRuns", () => {
    const entry: TaskRunControlEntry = {
      mode: "terminal-tab",
      nodes: {
        test: {
          label: "Test",
          panelId: "terminal-task",
          status: "succeeded",
          taskId: "test",
        },
      },
      projectRootPath: "/repo",
      rootTaskId: "test",
      runId: "run-1",
      startedAt: 1,
      status: "succeeded",
      updatedAt: 2,
    };
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { "run-1": entry }, version: 1 },
    });
    expect(shouldRetainTaskResultPanel("terminal-task", undefined)).toBe(true);
  });

  it("does not retain plain shell panels", () => {
    expect(shouldRetainTaskResultPanel("terminal-shell", undefined)).toBe(
      false
    );
  });

  it("retains panels with TerminalEndState (agent result)", () => {
    useTerminalEndStateStore.getState().upsertAgentEnd({
      agentId: "omp",
      panelId: "terminal-agent-1",
    });
    expect(shouldRetainTaskResultPanel("terminal-agent-1", undefined)).toBe(
      true
    );
  });
});
