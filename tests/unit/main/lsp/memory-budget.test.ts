import { describe, expect, it, vi } from "vitest";
import { createLspMemoryBudgetMonitor } from "../../../../src/main/services/lsp/memory-budget.ts";
import type { LspWorkspaceRuntimeState } from "../../../../src/main/services/lsp/workspace-policy.ts";

const MB = 1024 * 1024;

function workspace(
  overrides: Partial<LspWorkspaceRuntimeState> & { workspaceKey: string }
): LspWorkspaceRuntimeState {
  return {
    active: true,
    agentBusy: false,
    isWorktree: false,
    kind: "local",
    lastTouchAt: 0,
    refCount: 0,
    rootPath: `/repo/${overrides.workspaceKey}`,
    sessionIds: [],
    ...overrides,
  };
}

function createHarness(input: {
  budgetMb: number;
  processRows: Array<{ pid: number; ppid: number; rssBytes: number }>;
  sessions: Array<{
    pid: number | null;
    sessionId: string;
    workspaceKey: string;
  }>;
  workspaces: LspWorkspaceRuntimeState[];
  blockedWorkspaceKeys?: string[];
  enabled?: boolean;
}) {
  const closed: Array<{ cause: string; workspaceKey: string }> = [];
  const monitor = createLspMemoryBudgetMonitor({
    closeWorkspaceSessions: async (workspaceKey, cause) => {
      closed.push({ cause, workspaceKey });
    },
    listProcessTable: async () => input.processRows,
    listSessions: () => input.sessions,
    logger: { error: vi.fn(), warn: vi.fn() },
    policy: {
      getPrefs: () => ({
        customServers: [],
        enabled: input.enabled ?? true,
        idleReleaseMs: 1_800_000,
        maxLocalWorkspaces: 3,
        maxRemoteWorkspaces: 2,
        memoryBudgetMb: input.budgetMb,
        worktreesEnabled: true,
      }),
      hasTreeBlocker: (workspaceKey) =>
        input.blockedWorkspaceKeys?.includes(workspaceKey) ?? false,
      listActive: () => input.workspaces,
    },
  });
  return { closed, monitor };
}

describe("LSP memory budget safety net", () => {
  it("reaps the coldest eligible workspaces until under budget, never the hottest", async () => {
    const { closed, monitor } = createHarness({
      budgetMb: 1000,
      processRows: [
        // cold 工作区：tls(1) + tsserver 子进程(11) = 900MB。
        { pid: 1, ppid: 0, rssBytes: 300 * MB },
        { pid: 11, ppid: 1, rssBytes: 600 * MB },
        // warm 工作区：500MB。
        { pid: 2, ppid: 0, rssBytes: 500 * MB },
        // hot 工作区：400MB。
        { pid: 3, ppid: 0, rssBytes: 400 * MB },
      ],
      sessions: [
        { pid: 1, sessionId: "lsp-1", workspaceKey: "main:/cold" },
        { pid: 2, sessionId: "lsp-2", workspaceKey: "main:/warm" },
        { pid: 3, sessionId: "lsp-3", workspaceKey: "main:/hot" },
      ],
      workspaces: [
        workspace({ lastTouchAt: 100, workspaceKey: "main:/cold" }),
        workspace({ lastTouchAt: 200, workspaceKey: "main:/warm" }),
        workspace({ lastTouchAt: 300, workspaceKey: "main:/hot" }),
      ],
    });

    await monitor.sampleOnce();

    // 总量 1800MB > 1000MB：先收 cold(900) → 900 ≤ 1000，warm/hot 保留。
    expect(closed).toEqual([
      { cause: "idle-release", workspaceKey: "main:/cold" },
    ]);
  });

  it("skips agent-busy, in-flight, and tree-blocked workspaces", async () => {
    const { closed, monitor } = createHarness({
      blockedWorkspaceKeys: ["main:/blocked"],
      budgetMb: 100,
      processRows: [
        { pid: 1, ppid: 0, rssBytes: 200 * MB },
        { pid: 2, ppid: 0, rssBytes: 200 * MB },
        { pid: 3, ppid: 0, rssBytes: 200 * MB },
        { pid: 4, ppid: 0, rssBytes: 200 * MB },
      ],
      sessions: [
        { pid: 1, sessionId: "lsp-1", workspaceKey: "main:/agent" },
        { pid: 2, sessionId: "lsp-2", workspaceKey: "main:/inflight" },
        { pid: 3, sessionId: "lsp-3", workspaceKey: "main:/blocked" },
        { pid: 4, sessionId: "lsp-4", workspaceKey: "main:/idle" },
      ],
      workspaces: [
        workspace({
          agentBusy: true,
          lastTouchAt: 10,
          workspaceKey: "main:/agent",
        }),
        workspace({
          lastTouchAt: 20,
          refCount: 1,
          workspaceKey: "main:/inflight",
        }),
        workspace({ lastTouchAt: 30, workspaceKey: "main:/blocked" }),
        workspace({ lastTouchAt: 40, workspaceKey: "main:/idle" }),
        workspace({ lastTouchAt: 50, workspaceKey: "main:/hottest" }),
      ],
    });

    await monitor.sampleOnce();

    expect(closed).toEqual([
      { cause: "idle-release", workspaceKey: "main:/idle" },
    ]);
  });

  it("keeps a single over-budget workspace alive to avoid thrash", async () => {
    const { closed, monitor } = createHarness({
      budgetMb: 500,
      processRows: [{ pid: 1, ppid: 0, rssBytes: 2000 * MB }],
      sessions: [{ pid: 1, sessionId: "lsp-1", workspaceKey: "main:/only" }],
      workspaces: [workspace({ lastTouchAt: 10, workspaceKey: "main:/only" })],
    });

    await monitor.sampleOnce();

    expect(closed).toEqual([]);
  });

  it("does nothing under budget, when disabled, or when the budget is 0", async () => {
    const base = {
      processRows: [{ pid: 1, ppid: 0, rssBytes: 100 * MB }],
      sessions: [{ pid: 1, sessionId: "lsp-1", workspaceKey: "main:/a" }],
      workspaces: [workspace({ lastTouchAt: 10, workspaceKey: "main:/a" })],
    };
    const under = createHarness({ ...base, budgetMb: 1000 });
    await under.monitor.sampleOnce();
    expect(under.closed).toEqual([]);

    const disabled = createHarness({ ...base, budgetMb: 10, enabled: false });
    await disabled.monitor.sampleOnce();
    expect(disabled.closed).toEqual([]);

    const unlimited = createHarness({ ...base, budgetMb: 0 });
    await unlimited.monitor.sampleOnce();
    expect(unlimited.closed).toEqual([]);
  });
});
