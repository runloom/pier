import { beforeEach, describe, expect, it } from "vitest";
import {
  assembleSessionRows,
  identityFromActivity,
  sumSessionWorkload,
} from "../../../src/main/services/pier-resource/assemble-sessions.ts";
import type { ProcessTableRow } from "../../../src/main/services/pier-resource/process-table.ts";
import {
  clearTerminalResourceSessionsForWindow,
  listTerminalResourceSessions,
  registerTerminalResourceSession,
  resetTerminalResourceRegistryForTests,
} from "../../../src/main/services/pier-resource/terminal-session-registry.ts";

const processes: ProcessTableRow[] = [
  {
    cpuPercent: 0.1,
    name: "PierDev",
    pid: 50,
    ppid: 1,
    rssBytes: 100 * 1024 * 1024,
  },
  {
    cpuPercent: 0,
    name: "login",
    pid: 99,
    ppid: 50,
    rssBytes: 2 * 1024 * 1024,
  },
  {
    cpuPercent: 0.01,
    name: "-/bin/zsh",
    pid: 100,
    ppid: 99,
    rssBytes: 20 * 1024 * 1024,
  },
  {
    cpuPercent: 0.8,
    name: "node",
    pid: 101,
    ppid: 100,
    rssBytes: 200 * 1024 * 1024,
  },
  {
    cpuPercent: 0,
    name: "login",
    pid: 199,
    ppid: 50,
    rssBytes: 2 * 1024 * 1024,
  },
  {
    cpuPercent: 0.02,
    name: "/bin/zsh",
    pid: 200,
    ppid: 199,
    rssBytes: 15 * 1024 * 1024,
  },
];

beforeEach(() => {
  resetTerminalResourceRegistryForTests();
});

describe("assembleSessionRows", () => {
  it("lists registered terminals and binds via env markers (stable panel identity)", () => {
    registerTerminalResourceSession({ panelId: "panel-a", windowId: "1" });
    registerTerminalResourceSession({ panelId: "panel-b", windowId: "1" });

    // 故意反转「创建顺序 vs login pid」：marker 仍按 panel 正确绑定
    const rows = assembleSessionRows({
      activities: [
        {
          agentId: "codex",
          kind: "agent",
          panelId: "panel-a",
          sessionTitle: "Refactor helpers",
          source: "hook",
          spawnedAt: 1,
          status: "processing",
          subagentCount: 0,
          updatedAt: 2,
          windowId: "1",
        },
      ],
      appPids: [50],
      markers: [
        // panel-a → 较大 login pid 树（node 子进程）
        { panelId: "panel-a", pid: 101, windowId: "1" },
        // panel-b → 较小 login pid 树
        { panelId: "panel-b", pid: 200, windowId: "1" },
      ],
      processes,
    });

    expect(rows).toHaveLength(2);
    const hot = rows.find((row) => row.panelId === "panel-a");
    expect(hot?.shellPid).toBe(100);
    expect(hot?.memoryBytes).toBe(220 * 1024 * 1024);
    expect(hot?.cpuPercent).toBeCloseTo(0.81);
    expect(hot?.identity).toMatchObject({
      agentId: "codex",
      kind: "agent",
    });
    expect(hot?.hot).toBe(true);

    const idle = rows.find((row) => row.panelId === "panel-b");
    expect(idle?.shellPid).toBe(200);
    expect(idle?.memoryBytes).toBe(15 * 1024 * 1024);
    expect(idle?.identity).toEqual({ kind: "terminal" });
  });

  it("does not FIFO-zip multiple unbound sessions to login shells", () => {
    registerTerminalResourceSession({ panelId: "panel-a", windowId: "1" });
    registerTerminalResourceSession({ panelId: "panel-b", windowId: "1" });

    const rows = assembleSessionRows({
      activities: [],
      appPids: [50],
      markers: [],
      processes,
    });

    // 多会话无标记：宁可不绑，也不要按索引错配
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.shellPid === null)).toBe(true);
    expect(rows.every((row) => row.memoryBytes === null)).toBe(true);
  });

  it("binds uniquely when only one unclaimed session and one login shell", () => {
    registerTerminalResourceSession({ panelId: "panel-only", windowId: "1" });
    const rows = assembleSessionRows({
      activities: [],
      appPids: [50],
      markers: [],
      processes: processes.filter((row) => row.pid < 150),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.shellPid).toBe(100);
    expect(rows[0]?.memoryBytes).toBe(220 * 1024 * 1024);
  });

  it("aggregates marker-only panels without prior registration", () => {
    // 无 register：reload 竞态下仅有 env 标记
    const rows = assembleSessionRows({
      activities: [],
      appPids: [50],
      markers: [{ panelId: "panel-reload", pid: 101, windowId: "1" }],
      processes,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.panelId).toBe("panel-reload");
    expect(rows[0]?.shellPid).toBe(100);
    expect(rows[0]?.memoryBytes).toBe(220 * 1024 * 1024);
    // reconcile 会 auto-register
    expect(
      listTerminalResourceSessions().some((s) => s.panelId === "panel-reload")
    ).toBe(true);
  });

  it("clears registry entries for a window", () => {
    registerTerminalResourceSession({ panelId: "panel-a", windowId: "1" });
    registerTerminalResourceSession({ panelId: "panel-b", windowId: "2" });
    clearTerminalResourceSessionsForWindow("1");
    const remaining = listTerminalResourceSessions();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.windowId).toBe("2");

    const rows = assembleSessionRows({
      activities: [],
      appPids: [50],
      markers: [],
      processes: processes.filter((row) => row.pid < 150),
    });
    // window 1 已清；window 2 唯一 unclaimed + 一个 login → 1:1 绑定
    expect(rows.every((row) => row.windowId !== "1")).toBe(true);
  });
});

describe("identityFromActivity / sumSessionWorkload", () => {
  it("maps task identity and sums workload", () => {
    expect(
      identityFromActivity({
        kind: "task",
        label: "build",
        panelId: "p",
        runId: "r",
        spawnedAt: 1,
        taskId: "t",
        updatedAt: 2,
        windowId: "1",
      })
    ).toEqual({
      kind: "task",
      label: "build",
      runId: "r",
      taskId: "t",
    });

    const sum = sumSessionWorkload([
      {
        cpuPercent: 0.5,
        hot: true,
        identity: { kind: "terminal" },
        memoryBytes: 100,
        panelId: "a",
        processCount: 2,
        shellPid: 10,
        topProcess: null,
        windowId: "1",
      },
      {
        cpuPercent: 0.25,
        hot: false,
        identity: { kind: "terminal" },
        memoryBytes: 50,
        panelId: "b",
        processCount: 1,
        shellPid: 20,
        topProcess: null,
        windowId: "1",
      },
    ]);
    expect(sum.cpuPercent).toBeCloseTo(0.75);
    expect(sum.memoryBytes).toBe(150);
  });
});
