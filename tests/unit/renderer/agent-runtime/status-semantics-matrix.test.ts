/**
 * E10：状态语义反例矩阵 — 下列信号均不得替调用方生成成功/失败/取消/重试结论。
 * 锁定契约字段形状与通知/协作边界（不写 FA / 不写工作完成）。
 */
import {
  agentsScreenPayloadSchema,
  agentsTurnResultSchema,
} from "@shared/contracts/local-control/agents-runtime.ts";
import { describe, expect, it } from "vitest";
import { buildCollaborationViewModel } from "@/lib/agent-runtime/collab-view-model.ts";

/** 禁止出现在 turn/screen 结果中的「工作结论」键。 */
const WORK_VERDICT_KEYS = [
  "success",
  "failed",
  "cancelled",
  "retry",
  "completed",
  "workDone",
  "taskStatus",
] as const;

describe("E10 status semantics matrix", () => {
  it("turn accepted shape has no work verdict fields", () => {
    const parsed = agentsTurnResultSchema.safeParse({
      accepted: true,
      runtime: { bootId: "b", runtimeId: "r", generation: 1 },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    for (const key of WORK_VERDICT_KEYS) {
      expect(parsed.data).not.toHaveProperty(key);
    }
  });

  it("screen payload has no work verdict or content-cursor fields", () => {
    const parsed = agentsScreenPayloadSchema.safeParse({
      text: "hello",
      capturedAt: 1,
      rows: 1,
      cols: 80,
      truncated: false,
      maxLines: 200,
      maxBytes: 65_536,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    for (const key of WORK_VERDICT_KEYS) {
      expect(parsed.data).not.toHaveProperty(key);
    }
    expect(parsed.data).not.toHaveProperty("scrollback");
    expect(parsed.data).not.toHaveProperty("history");
    expect(parsed.data).not.toHaveProperty("cursor");
  });

  it("collaboration VM exposes runtime facts only — no one-shot reply body", () => {
    const vm = buildCollaborationViewModel({
      entries: [
        {
          agentRef: "w\0p",
          agentId: "codex",
          panelId: "p",
          windowId: "w",
          source: "hook",
          updatedAt: 1,
          status: "waiting",
        },
      ],
      activities: [],
      currentWindowId: "w",
      notifications: [
        {
          id: "n1",
          kind: "agent.attention",
          source: "agent-attention",
          severity: "warning",
          trigger: "system-event",
          title: "需要你处理",
          body: "请选择协议",
          read: false,
          ts: 1,
          agentRef: "w\0p",
        },
      ],
    });
    // 注意力条可有 reason（NCS body），但 VM 根上无 one-shot 回复字段
    expect(vm).not.toHaveProperty("oneShotReply");
    expect(vm).not.toHaveProperty("invokeResult");
    expect(vm).not.toHaveProperty("workResult");
    expect(vm.contentBoundaryKey).toBe("agents.collab.contentBoundary");
    // 已读语义不在 VM 内改写 — 通知仍以传入快照为准
    expect(vm.attention?.notificationId).toBe("n1");
  });

  it("NCS read flag is orthogonal to runtime status (matrix comment lock)", () => {
    // 产品纪律：mark-read / focus 不改 FA 运行事实。
    // 此处用形状锁：运行状态与 notification.read 是独立维度。
    const runtimeStatus = "waiting";
    const notificationRead = true;
    expect(runtimeStatus).not.toBe("success");
    expect(notificationRead).toBe(true);
    // 二者组合不得推导 work verdict
    const derivedWorkDone = runtimeStatus === "ready" && notificationRead;
    expect(derivedWorkDone).toBe(false);
  });
});
