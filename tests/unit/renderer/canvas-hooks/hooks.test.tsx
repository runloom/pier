import type { AgentActivity } from "@shared/contracts/foreground-activity.ts";
import { emptyTaskRunsSnapshot } from "@shared/contracts/tasks.ts";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  rememberElectronWindowId,
  resetElectronWindowIdForTests,
} from "@/lib/agent-runtime/current-window-id.ts";
import { useActivityOverview } from "@/lib/live-modules/canvas-hooks/use-activity-overview.ts";
import { useCostOverview } from "@/lib/live-modules/canvas-hooks/use-cost-overview.ts";
import { useSystemResources } from "@/lib/live-modules/canvas-hooks/use-system-resources.ts";
import {
  activityCounts,
  useForegroundActivityStore,
} from "@/stores/foreground-activity.store.ts";
import * as resourceModule from "@/stores/pier-resource.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";
import { useUsageDataStore } from "@/stores/usage-data.store.ts";

function makeAgentActivity(
  overrides: Partial<AgentActivity> = {}
): AgentActivity {
  return {
    kind: "agent",
    panelId: "p1",
    windowId: "w1",
    spawnedAt: 0,
    updatedAt: 0,
    agentId: "claude",
    status: "processing",
    source: "hook",
    subagentCount: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  useForegroundActivityStore.setState({ activities: {}, ts: 0 });
  resetElectronWindowIdForTests();
  useTaskRunsStore.setState({
    error: null,
    initialized: false,
    snapshot: emptyTaskRunsSnapshot(),
  });
  useUsageDataStore.getState().reset();
});

describe("canvas hooks", () => {
  it("useActivityOverview returns window-scoped counts and rows", () => {
    useForegroundActivityStore.setState({
      activities: { p1: makeAgentActivity() },
      ts: 1,
    });
    const { result } = renderHook(() => useActivityOverview());
    expect(result.current.counts.running).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(result.current.rows)).toBe(true);
    expect(activityCounts({}, undefined)).toEqual({
      inProgress: 0,
      needsYou: 0,
      running: 0,
    });
  });
  it("useActivityOverview excludes other-window task runs from rows", () => {
    rememberElectronWindowId("win-local");
    useForegroundActivityStore.setState({
      activities: { p1: makeAgentActivity({ windowId: "win-local" }) },
      ts: 1,
    });
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: {
        runs: {
          "run-local": {
            mode: "background",
            nodes: {
              test: {
                label: "local-build",
                panelId: "bg-local",
                status: "running",
                taskId: "package-script:test",
              },
            },
            originPanelId: "terminal-local",
            ownerWindowId: "win-local",
            projectRootPath: "/repo",
            rootTaskId: "package-script:test",
            runId: "run-local",
            startedAt: 1,
            status: "running",
            updatedAt: 2,
          },
          "run-other": {
            mode: "background",
            nodes: {
              test: {
                label: "remote-test",
                panelId: "bg-other",
                status: "running",
                taskId: "package-script:test",
              },
            },
            originPanelId: "terminal-other",
            ownerWindowId: "win-other",
            projectRootPath: "/repo",
            rootTaskId: "package-script:test",
            runId: "run-other",
            startedAt: 1,
            status: "running",
            updatedAt: 3,
          },
        },
        version: 1,
      },
    });

    const { result } = renderHook(() => useActivityOverview());
    const taskRunIds = new Set(
      result.current.rows
        .filter((row) => row.kind === "task")
        .map((row) => row.runId)
    );
    expect(taskRunIds.has("run-other")).toBe(false);
    expect(taskRunIds.has("run-local")).toBe(true);
    // rows 与 counts 同参语义：合并列表行数即 inProgress。
    expect(result.current.counts.inProgress).toBe(result.current.rows.length);
  });

  it("useSystemResources acquires polling while mounted and releases after", () => {
    const release = vi.fn();
    const acquire = vi
      .spyOn(resourceModule, "acquirePierResourcePolling")
      .mockReturnValue(release);
    const { unmount } = renderHook(() => useSystemResources());
    expect(acquire).toHaveBeenCalledTimes(1);
    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("useCostOverview is read-only and has no refresh method", () => {
    const { result } = renderHook(() => useCostOverview());
    expect(result.current).toEqual({
      snapshot: null,
      status: "loading",
    });
    expect(result.current).not.toHaveProperty("refresh");
  });
});
