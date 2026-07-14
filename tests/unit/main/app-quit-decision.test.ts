import type {
  ActivityStatus,
  AgentActivity,
  ForegroundActivity,
  IdleActivity,
  ShellActivity,
  TaskActivity,
} from "@shared/contracts/foreground-activity.ts";
import { describe, expect, it } from "vitest";
import {
  isDangerousQuitActivity,
  shouldConfirmBeforeQuit,
  summarizeDangerousQuitActivities,
  summarizeQuitActivity,
} from "../../../src/main/app-quit/quit-decision.ts";

const BASE_ACTIVITY = {
  panelId: "panel-1",
  windowId: "window-1",
  spawnedAt: 100,
  updatedAt: 200,
} as const;

const AGENT_SOURCES = [
  "hook",
  "launch",
] satisfies readonly AgentActivity["source"][];
const AGENT_STATUSES = [
  undefined,
  "ready",
  "processing",
  "tool",
  "waiting",
  "error",
] satisfies readonly (ActivityStatus | undefined)[];

function shellActivity(commandLine = "npm test"): ShellActivity {
  return {
    kind: "shell",
    ...BASE_ACTIVITY,
    commandLine,
  };
}

function agentActivity({
  source = "hook",
  status = "processing",
}: {
  source?: AgentActivity["source"];
  status?: AgentActivity["status"];
} = {}): AgentActivity {
  const activity: AgentActivity = {
    kind: "agent",
    ...BASE_ACTIVITY,
    agentId: "codex",
    source,
    subagentCount: 0,
  };

  if (status !== undefined) {
    activity.status = status;
  }

  return activity;
}

function taskActivity(): TaskActivity {
  return {
    kind: "task",
    runId: "run-1",
    ...BASE_ACTIVITY,
    taskId: "task-1",
    label: "Build release",
  };
}

function idleActivity(): IdleActivity {
  return {
    kind: "idle",
    ...BASE_ACTIVITY,
  };
}

describe("shouldConfirmBeforeQuit", () => {
  it.each([
    { mode: "never", count: 3, expected: false },
    { mode: "always", count: 0, expected: true },
    { mode: "hasActivity", count: 0, expected: false },
    { mode: "hasActivity", count: 1, expected: true },
  ] as const)("returns $expected for mode=$mode with $count dangerous activities", ({
    mode,
    count,
    expected,
  }) => {
    expect(shouldConfirmBeforeQuit(mode, count)).toBe(expected);
  });
});

describe("isDangerousQuitActivity", () => {
  it("treats shell activity as dangerous", () => {
    expect(isDangerousQuitActivity(shellActivity("pnpm test"))).toBe(true);
  });

  it.each(
    AGENT_SOURCES.flatMap((source) =>
      AGENT_STATUSES.map((status) => ({
        source,
        status,
      }))
    )
  )("treats agent activity as dangerous for source=$source status=$status", ({
    source,
    status,
  }) => {
    expect(isDangerousQuitActivity(agentActivity({ source, status }))).toBe(
      true
    );
  });

  it("treats task occupation pointer as dangerous", () => {
    expect(isDangerousQuitActivity(taskActivity())).toBe(true);
  });

  it("treats idle activity as not dangerous", () => {
    expect(isDangerousQuitActivity(idleActivity())).toBe(false);
  });
});

describe("summarizeQuitActivity", () => {
  it("trims shell command lines and preserves the trimmed command in the summary", () => {
    expect(summarizeQuitActivity(shellActivity("  pnpm test:unit  "))).toEqual({
      kind: "shell",
      label: "pnpm test:unit",
      panelId: BASE_ACTIVITY.panelId,
      commandLine: "pnpm test:unit",
      windowId: BASE_ACTIVITY.windowId,
    });
  });

  it.each([
    "",
    "   \t\n  ",
  ])("uses the fallback shell label and omits commandLine for blank command %j", (commandLine) => {
    expect(summarizeQuitActivity(shellActivity(commandLine))).toEqual({
      kind: "shell",
      label: "Shell command",
      panelId: BASE_ACTIVITY.panelId,
      windowId: BASE_ACTIVITY.windowId,
    });
  });

  it("summarizes agent activity with the agent id and panel/window ids", () => {
    expect(
      summarizeQuitActivity(
        agentActivity({ source: "launch", status: undefined })
      )
    ).toEqual({
      kind: "agent",
      label: "codex",
      panelId: BASE_ACTIVITY.panelId,
      windowId: BASE_ACTIVITY.windowId,
    });
  });

  it("summarizes task occupation with the task label and panel/window ids", () => {
    expect(summarizeQuitActivity(taskActivity())).toEqual({
      kind: "task",
      label: "Build release",
      panelId: BASE_ACTIVITY.panelId,
      windowId: BASE_ACTIVITY.windowId,
    });
  });

  it.each([
    { name: "idle panel", activity: idleActivity() },
  ] satisfies readonly {
    name: string;
    activity: ForegroundActivity;
  }[])("returns null for $name", ({ activity }) => {
    expect(summarizeQuitActivity(activity)).toBeNull();
  });
});

describe("summarizeDangerousQuitActivities", () => {
  it("filters out non-dangerous activities and returns summaries for dangerous activities", () => {
    const activities: ForegroundActivity[] = [
      idleActivity(),
      shellActivity("  pnpm build  "),
      taskActivity(),
      agentActivity({ source: "hook", status: "ready" }),
    ];

    expect(summarizeDangerousQuitActivities(activities)).toEqual([
      {
        kind: "shell",
        label: "pnpm build",
        panelId: BASE_ACTIVITY.panelId,
        commandLine: "pnpm build",
        windowId: BASE_ACTIVITY.windowId,
      },
      {
        kind: "task",
        label: "Build release",
        panelId: BASE_ACTIVITY.panelId,
        windowId: BASE_ACTIVITY.windowId,
      },
      {
        kind: "agent",
        label: "codex",
        panelId: BASE_ACTIVITY.panelId,
        windowId: BASE_ACTIVITY.windowId,
      },
    ]);
  });

  it("includes active background task runs not represented in foreground activity", () => {
    const activities: ForegroundActivity[] = [idleActivity()];
    const taskRuns = {
      runs: {
        "run-bg": {
          mode: "background" as const,
          nodes: {
            test: {
              label: "test",
              panelId: "background-task:run-bg:test",
              status: "running" as const,
              taskId: "package-script:test",
            },
          },
          originPanelId: "terminal-1",
          ownerWindowId: "window-1",
          projectRootPath: "/repo",
          rootTaskId: "package-script:test",
          runId: "run-bg",
          startedAt: 1,
          status: "running" as const,
          updatedAt: 2,
        },
      },
      version: 1,
    };

    expect(summarizeDangerousQuitActivities(activities, taskRuns)).toEqual([
      {
        kind: "task",
        label: "test",
        panelId: "terminal-1",
        windowId: "window-1",
      },
    ]);
  });
});
