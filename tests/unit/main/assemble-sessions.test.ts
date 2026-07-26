import { beforeEach, describe, expect, it } from "vitest";
import {
  assembleSessionRows,
  identityFromActivity,
  sumSessionWorkload,
} from "../../../src/main/services/pier-resource/assemble-sessions.ts";
import type { ProcessTableRow } from "../../../src/main/services/pier-resource/process-table.ts";
import {
  bindTerminalResourceSeed,
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
  // 同 login 下旁路进程（不在嵌套 shell 子树内）——login 根应计入
  {
    cpuPercent: 0.1,
    name: "-claude",
    pid: 150,
    ppid: 99,
    rssBytes: 590 * 1024 * 1024,
  },
];

/** login 99 树：login 2 + zsh 20 + node 200 + claude 590 = 812 MB */
const PANEL_A_MEMORY = (2 + 20 + 200 + 590) * 1024 * 1024;
/** login 199 树：login 2 + zsh 15 = 17 MB */
const PANEL_B_MEMORY = (2 + 15) * 1024 * 1024;

beforeEach(() => {
  resetTerminalResourceRegistryForTests();
});

describe("assembleSessionRows", () => {
  it("lists registered terminals and binds via env markers to login root", () => {
    registerTerminalResourceSession({ panelId: "panel-a", windowId: "1" });
    registerTerminalResourceSession({ panelId: "panel-b", windowId: "1" });

    // 故意用深层 node 标记；根应收敛到 login，含旁路 agent
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
        { panelId: "panel-a", pid: 101, windowId: "1" },
        { panelId: "panel-b", pid: 200, windowId: "1" },
      ],
      processes,
    });

    expect(rows).toHaveLength(2);
    const hot = rows.find((row) => row.panelId === "panel-a");
    expect(hot?.shellPid).toBe(100);
    expect(hot?.memoryBytes).toBe(PANEL_A_MEMORY);
    expect(hot?.cpuPercent).toBeCloseTo(0.91);
    expect(hot?.identity).toMatchObject({
      agentId: "codex",
      kind: "agent",
    });
    expect(hot?.hot).toBe(true);

    const idle = rows.find((row) => row.panelId === "panel-b");
    expect(idle?.shellPid).toBe(200);
    expect(idle?.memoryBytes).toBe(PANEL_B_MEMORY);
    expect(idle?.identity).toEqual({ kind: "terminal" });
  });

  it("converges nested-shell markers and login-only markers to the same root", () => {
    registerTerminalResourceSession({ panelId: "panel-a", windowId: "1" });
    // 同一 panel：深层 node 与旁路 claude 标记都应钉在 login 99
    const fromNode = assembleSessionRows({
      activities: [],
      appPids: [50],
      markers: [{ panelId: "panel-a", pid: 101, windowId: "1" }],
      processes,
    });
    resetTerminalResourceRegistryForTests();
    registerTerminalResourceSession({ panelId: "panel-a", windowId: "1" });
    const fromAgent = assembleSessionRows({
      activities: [],
      appPids: [50],
      markers: [{ panelId: "panel-a", pid: 150, windowId: "1" }],
      processes,
    });
    expect(fromNode[0]?.memoryBytes).toBe(PANEL_A_MEMORY);
    expect(fromAgent[0]?.memoryBytes).toBe(PANEL_A_MEMORY);
    expect(fromNode[0]?.shellPid).toBe(100);
    // claude 的祖先无 shell 时 shellPid 可为 null，但 root 内存一致
    expect(fromAgent[0]?.memoryBytes).toBe(fromNode[0]?.memoryBytes);
  });

  it("binds via seedPid without env markers (idle multi-terminal path)", () => {
    bindTerminalResourceSeed({
      loginPid: 99,
      panelId: "panel-a",
      rootPid: 99,
      seedPid: 99,
      shellPid: 100,
      windowId: "1",
    });
    bindTerminalResourceSeed({
      loginPid: 199,
      panelId: "panel-b",
      rootPid: 199,
      seedPid: 199,
      shellPid: 200,
      windowId: "1",
    });
    const rows = assembleSessionRows({
      activities: [],
      appPids: [50],
      markers: [],
      processes,
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.panelId === "panel-a")?.memoryBytes).toBe(
      PANEL_A_MEMORY
    );
    expect(rows.find((r) => r.panelId === "panel-b")?.memoryBytes).toBe(
      PANEL_B_MEMORY
    );
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

    // 多会话无标记无 seed：宁可不绑，也不要按索引错配
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
    // login 根：含 login 2MB + zsh + node
    expect(rows[0]?.memoryBytes).toBe((2 + 20 + 200) * 1024 * 1024);
  });

  it("aggregates marker-only panels without prior registration", () => {
    const rows = assembleSessionRows({
      activities: [],
      appPids: [50],
      markers: [{ panelId: "panel-reload", pid: 101, windowId: "1" }],
      processes,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.panelId).toBe("panel-reload");
    expect(rows[0]?.shellPid).toBe(100);
    expect(rows[0]?.memoryBytes).toBe(PANEL_A_MEMORY);
    expect(
      listTerminalResourceSessions().some((s) => s.panelId === "panel-reload")
    ).toBe(true);
  });

  it("nulls session CPU on Linux-style request", () => {
    registerTerminalResourceSession({ panelId: "panel-a", windowId: "1" });
    const rows = assembleSessionRows({
      activities: [],
      appPids: [50],
      markers: [{ panelId: "panel-a", pid: 101, windowId: "1" }],
      nullSessionCpu: true,
      processes,
    });
    expect(rows[0]?.cpuPercent).toBeNull();
    expect(rows[0]?.memoryBytes).toBe(PANEL_A_MEMORY);
  });

  it("clears dead seed so metrics become unbound (null) not sticky zeros", () => {
    bindTerminalResourceSeed({
      loginPid: 999,
      panelId: "panel-dead",
      rootPid: 999,
      seedPid: 999,
      shellPid: 998,
      windowId: "1",
    });
    // 进程表无 999：seed 死
    const rows = assembleSessionRows({
      activities: [],
      appPids: [50],
      markers: [],
      processes,
    });
    const dead = rows.find((r) => r.panelId === "panel-dead");
    expect(dead?.memoryBytes).toBeNull();
    expect(dead?.cpuPercent).toBeNull();
    const reg = listTerminalResourceSessions().find(
      (s) => s.panelId === "panel-dead"
    );
    expect(reg?.seedPid).toBeNull();
    expect(reg?.rootPid).toBeNull();
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
