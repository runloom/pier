import { createControlSnapshotService } from "@main/services/control-snapshot/service.ts";
import { describe, expect, it } from "vitest";

describe("ControlSnapshotService (W4-S3)", () => {
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
    expect(a.activity[0]?.kind).toBe("agent");
    expect(a.windows[0]?.windowId).toBe("w1");
  });
});
