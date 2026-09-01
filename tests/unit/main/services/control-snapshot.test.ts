import {
  createControlSnapshotService,
  selectSnapshotNotifications,
} from "@main/services/control-snapshot/service.ts";
import { describe, expect, it } from "vitest";

describe("ControlSnapshotService (W4-S3 / W5-S4)", () => {
  it("snapshot includes agents/tasks/windows; revision only bumps on change", async () => {
    let agentStatus = "running";
    const svc = createControlSnapshotService({
      bootId: "boot-1",
      listAgents: () => ({
        entries: [
          {
            agentId: "codex",
            panelId: "p1",
            windowId: "w1",
            status: agentStatus,
          },
        ],
      }),
      listWindows: () => [{ id: "w1", focused: true, recordId: "r1" }],
      listPanels: async () => [
        {
          id: "p1",
          windowId: "w1",
          component: "terminal",
          active: true,
          context: { projectRootPath: "/repo", worktreeKey: "/repo" },
          params: { agentId: "codex" },
        },
      ],
      listTasks: () => [
        {
          runId: "run-1",
          status: "running",
          projectRootPath: "/repo",
          rootTaskId: "build",
        },
      ],
      listActivity: () => [
        { kind: "agent", status: agentStatus, panelId: "p1", windowId: "w1" },
        { kind: "shell", panelId: "p2", windowId: "w1" },
      ],
      listNotifications: () => [
        {
          id: "n1",
          kind: "agent.attention",
          severity: "warning",
          title: "需要你处理",
          read: false,
          ts: 2000,
          agentRef: "w\0p1",
        },
      ],
      listRuntimes: () => [
        {
          bootId: "boot-1",
          runtimeId: "p1",
          generation: 1,
          agentId: "codex",
          panelId: "p1",
          windowId: "w1",
          fact: "running",
          closed: false,
          cwd: "/repo",
        },
      ],
      nowMs: () => 1000,
    });
    const a = await svc.snapshot();
    const b = await svc.snapshot();
    expect(a.bootId).toBe("boot-1");
    expect(a.revision).toBe(1);
    // 相同摘要不抬 revision（watch 轮询不得刷屏）
    expect(b.revision).toBe(1);
    agentStatus = "waiting";
    const c = await svc.snapshot();
    expect(c.revision).toBe(2);
    expect(a.agents).toHaveLength(1);
    expect(a.tasks[0]?.runId).toBe("run-1");
    expect(a.panels[0]?.agentId).toBe("codex");
    expect(a.panels[0]?.canonicalPath).toBe("/repo");
    expect(a.activity.map((row) => row.kind)).toEqual(["agent", "shell"]);
    expect(a.windows[0]?.windowId).toBe("w1");
    expect(a.notifications).toHaveLength(1);
    expect(a.notifications[0]?.id).toBe("n1");
    // E11：runtimes 独立段，无 screen/text
    expect(a.runtimes).toHaveLength(1);
    expect(a.runtimes[0]).toMatchObject({
      runtimeId: "p1",
      generation: 1,
      fact: "running",
    });
    expect(a.runtimes[0]).not.toHaveProperty("text");
    expect(a.runtimes[0]).not.toHaveProperty("screen");
  });

  it("panels project title/cwd; canonicalPath prefers cwd over projectRootPath", async () => {
    const svc = createControlSnapshotService({
      bootId: "boot-1",
      listAgents: () => ({ entries: [] }),
      listWindows: () => [{ id: "w1", focused: true, recordId: "r1" }],
      listPanels: async () => [
        {
          id: "term-1",
          windowId: "w1",
          component: "terminal",
          active: true,
          context: {
            cwd: "/repo/packages/ui",
            projectRootPath: "/repo",
            worktreeKey: "/repo",
          },
          display: { short: "zsh" },
        },
        {
          id: "term-2",
          windowId: "w1",
          component: "terminal",
          context: { projectRootPath: "/other", worktreeKey: "/other" },
        },
      ],
      listTasks: () => [],
      listActivity: () => [],
      listNotifications: () => [],
      listRuntimes: () => [],
      nowMs: () => 1000,
    });
    const snap = await svc.snapshot();
    expect(snap.panels[0]).toMatchObject({
      panelId: "term-1",
      title: "zsh",
      cwd: "/repo/packages/ui",
      canonicalPath: "/repo/packages/ui",
      worktreeKey: "/repo",
    });
    expect(snap.panels[1]).toMatchObject({
      panelId: "term-2",
      canonicalPath: "/other",
    });
    expect(snap.panels[1]).not.toHaveProperty("title");
    expect(snap.panels[1]).not.toHaveProperty("cwd");
  });

  it("files.filePanel projects sourceRoot/sourcePath, not tab title", async () => {
    const svc = createControlSnapshotService({
      bootId: "boot-1",
      listAgents: () => ({ entries: [] }),
      listWindows: () => [{ id: "w1", focused: true }],
      listPanels: async () => [
        {
          id: "doc-1",
          windowId: "w1",
          component: "pier.files.filePanel",
          display: { short: "index.ts" },
          context: { cwd: "/repo", projectRootPath: "/repo" },
          params: {
            source: {
              kind: "disk",
              path: "src/main/index.ts",
              root: "/repo",
            },
          },
        },
      ],
      listTasks: () => [],
      listActivity: () => [],
      listNotifications: () => [],
      listRuntimes: () => [],
    });
    const snap = await svc.snapshot();
    expect(snap.panels[0]).toMatchObject({
      sourcePath: "src/main/index.ts",
      sourceRoot: "/repo",
      title: "index.ts",
    });
  });

  it("git.changes cwd is review gitRootPath, not shell cwd", async () => {
    const svc = createControlSnapshotService({
      bootId: "boot-1",
      listAgents: () => ({ entries: [] }),
      listWindows: () => [{ id: "w1", focused: true }],
      listPanels: async () => [
        {
          id: "git-1",
          windowId: "w1",
          component: "pier.git.changes",
          context: {
            cwd: "/home/me",
            gitRoot: "/repo",
            projectRootPath: "/repo",
            worktreeKey: "/repo",
          },
          params: {
            source: { contextId: "c1", gitRootPath: "/repo" },
          },
        },
        {
          id: "git-restored",
          windowId: "w1",
          component: "pier.git.changes",
          params: {
            source: { contextId: "c2", gitRootPath: "/wt-b" },
          },
        },
        {
          id: "term-1",
          windowId: "w1",
          component: "terminal",
          context: {
            cwd: "/repo/packages/ui",
            gitRoot: "/repo",
            projectRootPath: "/repo",
            worktreeKey: "/repo",
          },
        },
      ],
      listTasks: () => [],
      listActivity: () => [],
      listNotifications: () => [],
      listRuntimes: () => [],
      nowMs: () => 1,
    });
    const snap = await svc.snapshot();
    expect(snap.panels[0]).toMatchObject({
      panelId: "git-1",
      cwd: "/repo",
      canonicalPath: "/repo",
      gitRoot: "/repo",
      worktreeKey: "/repo",
    });
    expect(snap.panels[1]).toMatchObject({
      panelId: "git-restored",
      cwd: "/wt-b",
      canonicalPath: "/wt-b",
      gitRoot: "/wt-b",
      worktreeKey: "/wt-b",
    });
    expect(snap.panels[2]).toMatchObject({
      panelId: "term-1",
      cwd: "/repo/packages/ui",
      canonicalPath: "/repo/packages/ui",
      gitRoot: "/repo",
    });
  });

  it("non-git panels expose no gitRoot (worktreeKey alone is not a git oracle)", async () => {
    const svc = createControlSnapshotService({
      bootId: "boot-1",
      listAgents: () => ({ entries: [] }),
      listWindows: () => [{ id: "w1", focused: true }],
      listPanels: async () => [
        {
          id: "term-plain",
          windowId: "w1",
          component: "terminal",
          context: {
            cwd: "/Users/me/Downloads",
            projectRootPath: "/Users/me/Downloads",
            worktreeKey: "/Users/me/Downloads",
          },
        },
      ],
      listTasks: () => [],
      listActivity: () => [],
      listNotifications: () => [],
      listRuntimes: () => [],
      nowMs: () => 1,
    });
    const snap = await svc.snapshot();
    expect(snap.panels[0]).toMatchObject({
      panelId: "term-plain",
      cwd: "/Users/me/Downloads",
      worktreeKey: "/Users/me/Downloads",
    });
    expect(snap.panels[0]).not.toHaveProperty("gitRoot");
  });

  it("selectSnapshotNotifications prefers unread then newer ts", () => {
    const selected = selectSnapshotNotifications(
      [
        { id: "old-unread", read: false, ts: 1 },
        { id: "new-read", read: true, ts: 9 },
        { id: "new-unread", read: false, ts: 8 },
      ],
      2
    );
    expect(selected.map((row) => row.id)).toEqual(["new-unread", "old-unread"]);
  });
});
