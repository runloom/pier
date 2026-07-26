import {
  activityOverviewBucket,
  activityOverviewCounts,
  flattenGroupedActivityRows,
  groupActivityOverviewRows,
} from "@shared/activity-overview.ts";
import type {
  AgentActivity,
  ForegroundActivity,
  ShellActivity,
  TaskActivity,
} from "@shared/contracts/foreground-activity.ts";
import type { TaskRunsSnapshot } from "@shared/contracts/tasks.ts";
import { emptyTaskRunsSnapshot } from "@shared/contracts/tasks.ts";
import { describe, expect, it } from "vitest";

const base = {
  panelId: "p1",
  spawnedAt: 1000,
  updatedAt: 2000,
  windowId: "w1",
} as const;

function agent(
  overrides: Partial<AgentActivity> & Pick<AgentActivity, "status">
): AgentActivity {
  return {
    agentId: "claude",
    kind: "agent",
    source: "hook",
    subagentCount: 0,
    ...base,
    ...overrides,
  };
}

function shell(overrides: Partial<ShellActivity> = {}): ShellActivity {
  return {
    commandLine: "npm test",
    kind: "shell",
    ...base,
    panelId: "shell-1",
    ...overrides,
  };
}

function task(overrides: Partial<TaskActivity> = {}): TaskActivity {
  return {
    kind: "task",
    label: "build",
    runId: "run-1",
    taskId: "build",
    ...base,
    panelId: "task-1",
    ...overrides,
  };
}

function snapshotWithTask(
  status: "running" | "failed" | "blocked" | "pending"
): TaskRunsSnapshot {
  return {
    runs: {
      "run-1": {
        mode: "terminal-tab",
        nodes: {
          build: {
            label: "build",
            panelId: "task-1",
            status,
            taskId: "build",
            windowId: "w1",
          },
        },
        projectRootPath: "/repo",
        rootTaskId: "build",
        runId: "run-1",
        startedAt: 1000,
        status,
        updatedAt: 2000,
      },
    },
    version: 1,
  };
}

describe("activityOverviewCounts", () => {
  it("counts empty as zeros", () => {
    expect(activityOverviewCounts({}, emptyTaskRunsSnapshot())).toEqual({
      inProgress: 0,
      needsYou: 0,
      running: 0,
    });
  });

  it("puts waiting and error into needsYou, processing into running", () => {
    const activities: Record<string, ForegroundActivity> = {
      a: agent({ panelId: "a", status: "waiting", updatedAt: 3 }),
      b: agent({ panelId: "b", status: "error", updatedAt: 2 }),
      c: agent({ panelId: "c", status: "processing", updatedAt: 1 }),
      d: agent({
        panelId: "d",
        source: "launch",
        status: undefined as unknown as AgentActivity["status"],
        updatedAt: 4,
      }),
    };
    // launch-only: omit status properly
    activities.d = {
      agentId: "codex",
      kind: "agent",
      panelId: "d",
      source: "launch",
      spawnedAt: 1,
      subagentCount: 0,
      updatedAt: 4,
      windowId: "w1",
    };

    const counts = activityOverviewCounts(activities, emptyTaskRunsSnapshot());
    expect(counts.needsYou).toBe(2);
    expect(counts.running).toBe(1);
    expect(counts.inProgress).toBe(4);
  });

  it("includes active task runs in running", () => {
    const activities: Record<string, ForegroundActivity> = {
      "task-1": task(),
    };
    const counts = activityOverviewCounts(
      activities,
      snapshotWithTask("running")
    );
    expect(counts.running).toBe(1);
    expect(counts.inProgress).toBe(1);
    expect(counts.needsYou).toBe(0);
  });

  it("counts blocked/failed task rows as needsYou", () => {
    const activities: Record<string, ForegroundActivity> = {
      "task-1": task(),
    };
    expect(
      activityOverviewCounts(activities, snapshotWithTask("failed")).needsYou
    ).toBe(1);
    expect(
      activityOverviewCounts(activities, snapshotWithTask("blocked")).needsYou
    ).toBe(1);
  });

  it("scopes TaskRuns by windowId so other windows do not leak", () => {
    // 本窗 FA 为空；本机 TaskRuns 另有他窗活跃 task → 本窗 KPI 必须全 0。
    const taskRuns: TaskRunsSnapshot = {
      runs: {
        "run-other": {
          mode: "background",
          nodes: {
            test: {
              label: "test",
              panelId: "bg-other",
              status: "running",
              taskId: "package-script:test",
            },
          },
          originPanelId: "terminal-other",
          ownerWindowId: "w-other",
          projectRootPath: "/repo",
          rootTaskId: "package-script:test",
          runId: "run-other",
          startedAt: 1,
          status: "running",
          updatedAt: 2,
        },
        "run-local": {
          mode: "background",
          nodes: {
            lint: {
              label: "lint",
              panelId: "bg-local",
              status: "running",
              taskId: "package-script:lint",
            },
          },
          originPanelId: "terminal-local",
          ownerWindowId: "w1",
          projectRootPath: "/repo",
          rootTaskId: "package-script:lint",
          runId: "run-local",
          startedAt: 1,
          status: "running",
          updatedAt: 3,
        },
      },
      version: 1,
    };

    const unscoped = activityOverviewCounts({}, taskRuns);
    expect(unscoped.running).toBe(2);
    expect(unscoped.inProgress).toBe(2);

    const localOnly = activityOverviewCounts({}, taskRuns, {
      windowId: "w1",
    });
    expect(localOnly.running).toBe(1);
    expect(localOnly.inProgress).toBe(1);
    expect(localOnly.needsYou).toBe(0);

    const otherOnly = activityOverviewCounts({}, taskRuns, {
      windowId: "w-other",
    });
    expect(otherOnly.running).toBe(1);
    expect(otherOnly.inProgress).toBe(1);

    const groupedLocal = groupActivityOverviewRows({}, taskRuns, {
      windowId: "w1",
    });
    expect(groupedLocal.running.map((r) => r.runId)).toEqual(["run-local"]);
    expect(groupedLocal.needsYou).toEqual([]);
  });
});

describe("groupActivityOverviewRows", () => {
  it("orders needsYou before running before other; error before waiting", () => {
    const activities: Record<string, ForegroundActivity> = {
      shell: shell({ updatedAt: 99 }),
      wait: agent({
        panelId: "wait",
        status: "waiting",
        updatedAt: 10,
      }),
      err: agent({ panelId: "err", status: "error", updatedAt: 5 }),
      run: agent({
        panelId: "run",
        status: "tool",
        updatedAt: 50,
      }),
      ready: agent({
        panelId: "ready",
        status: "ready",
        updatedAt: 80,
      }),
    };

    const grouped = groupActivityOverviewRows(
      activities,
      emptyTaskRunsSnapshot()
    );
    expect(grouped.needsYou.map((r) => r.panelId)).toEqual(["err", "wait"]);
    expect(grouped.running.map((r) => r.panelId)).toEqual(["run"]);
    expect(grouped.other.map((r) => r.panelId)).toEqual(["shell-1", "ready"]);

    const flat = flattenGroupedActivityRows(grouped);
    expect(flat.map((r) => r.panelId)).toEqual([
      "err",
      "wait",
      "run",
      "shell-1",
      "ready",
    ]);
  });

  it("buckets shell as other and task running as running", () => {
    expect(activityOverviewBucket(shell(), emptyTaskRunsSnapshot())).toBe(
      "other"
    );
    expect(activityOverviewBucket(task(), snapshotWithTask("running"))).toBe(
      "running"
    );
    expect(activityOverviewBucket(task(), snapshotWithTask("failed"))).toBe(
      "needsYou"
    );
  });
});
