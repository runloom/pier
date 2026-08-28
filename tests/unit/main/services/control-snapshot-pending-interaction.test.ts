/**
 * control.snapshot activity 摘要携带 pendingInteractionId（M1 审批回写数据源）：
 * waiting 态 agent 且注册表有登记 → 附 pendingInteractionId；
 * waiting 无登记 / 非 waiting / 非 agent → 无该字段。
 */
import { createControlSnapshotService } from "@main/services/control-snapshot/service.ts";
import { describe, expect, it } from "vitest";

function sourcesWith(
  resolvePendingInteractionId?: (target: {
    panelId: string;
    windowId: string;
  }) => string | undefined
) {
  return {
    bootId: "boot-1",
    listActivity: () => [
      // waiting 且有登记
      { kind: "agent", panelId: "p1", status: "waiting", windowId: "w1" },
      // waiting 但无登记
      { kind: "agent", panelId: "p2", status: "waiting", windowId: "w1" },
      // 有登记但非 waiting —— 不得附（注册表滞后于状态迁移时防误导）
      { kind: "agent", panelId: "p3", status: "processing", windowId: "w1" },
      // 非 agent
      { kind: "shell", panelId: "p4", windowId: "w1" },
    ],
    listAgents: () => ({ entries: [] }),
    listPanels: async () => [],
    listTasks: () => [],
    listWindows: () => [],
    nowMs: () => 1000,
    ...(resolvePendingInteractionId ? { resolvePendingInteractionId } : {}),
  };
}

describe("control.snapshot pendingInteractionId 注入", () => {
  it("waiting agent 有登记 → 附 pendingInteractionId", async () => {
    const svc = createControlSnapshotService(
      sourcesWith(({ panelId, windowId }) =>
        windowId === "w1" && (panelId === "p1" || panelId === "p3")
          ? `ix-${panelId}`
          : undefined
      )
    );
    const snap = await svc.snapshot();
    expect(snap.activity[0]).toMatchObject({ pendingInteractionId: "ix-p1" });
  });

  it("waiting 且无登记 → 无该字段", async () => {
    const svc = createControlSnapshotService(
      sourcesWith(({ panelId }) => (panelId === "p1" ? "ix-p1" : undefined))
    );
    const snap = await svc.snapshot();
    expect(snap.activity[1]).toMatchObject({ status: "waiting" });
    expect(snap.activity[1]).not.toHaveProperty("pendingInteractionId");
  });

  it("非 waiting / 非 agent 条目不附（即使解析器有登记）", async () => {
    const svc = createControlSnapshotService(sourcesWith(() => "ix-any"));
    const snap = await svc.snapshot();
    expect(snap.activity[2]).not.toHaveProperty("pendingInteractionId");
    expect(snap.activity[3]).not.toHaveProperty("pendingInteractionId");
  });

  it("解析器缺省 → 所有条目无该字段", async () => {
    const svc = createControlSnapshotService(sourcesWith());
    const snap = await svc.snapshot();
    for (const entry of snap.activity) {
      expect(entry).not.toHaveProperty("pendingInteractionId");
    }
  });
});
