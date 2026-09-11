import { createAgentAttentionService } from "@main/services/agent-attention/service.ts";
import { createForegroundActivityAggregator } from "@main/services/foreground-activity/aggregator.ts";
import type { AgentEventIngestOptions } from "@main/services/foreground-activity/types.ts";
import type { AgentHookEventPayloadV1 } from "@shared/contracts/agent/session.ts";
import type { AgentActivity } from "@shared/contracts/foreground-activity.ts";
import type { NotificationReport } from "@shared/contracts/notification-center.ts";
import { describe, expect, it } from "vitest";

const OPTIONS: AgentEventIngestOptions = {
  evidenceSource: "hook",
  stopAuthority: "advisory",
  turnStartAuthority: "none",
};

function setup() {
  const aggregator = createForegroundActivityAggregator();
  const ingest = (
    event: string,
    details: Partial<AgentHookEventPayloadV1> & { interactionId?: string } = {}
  ) =>
    aggregator.ingestAgentEvent(
      {
        agent: "opencode",
        event,
        kind: "agentEvent",
        panelId: "p1",
        sessionId: "main",
        v: 1,
        windowId: "w1",
        ...details,
      },
      OPTIONS
    );
  const activity = () => aggregator.snapshot().activities[0] as AgentActivity;
  return { activity, aggregator, ingest };
}

describe("原生空闲独立于回合结果", () => {
  it("当前会话空闲后 ready，同回合工具仍可继续，不伪造成功结果", () => {
    const { aggregator, activity, ingest } = setup();
    try {
      ingest("PromptSubmit", { turnId: "turn-a" });
      expect(ingest("ActivityIdle", { turnId: "turn-a" })).toBe(true);
      expect(activity().status).toBe("ready");
      expect(activity()).not.toHaveProperty("turnResult");
      ingest("ToolStart", { toolUseId: "tool-a", turnId: "turn-a" });
      expect(activity().status).toBe("tool");
      ingest("ToolComplete", { toolUseId: "tool-a", turnId: "turn-a" });
      expect(activity().status).toBe("processing");
    } finally {
      aggregator.dispose();
    }
  });

  it("空闲不清除工具、问答和子智能体；最后工作结束时使用已知空闲事实", () => {
    const { aggregator, activity, ingest } = setup();
    try {
      ingest("PromptSubmit");
      ingest("ToolStart", { toolUseId: "tool-a" });
      ingest("InteractionRequested", { interactionId: "question-a" });
      ingest("SubagentStart", { agentInstanceId: "child-a" });
      ingest("ActivityIdle");
      expect(activity()).toMatchObject({ status: "waiting", subagentCount: 1 });
      ingest("InteractionResolved", { interactionId: "question-a" });
      expect(activity().status).toBe("tool");
      ingest("ToolComplete", { toolUseId: "tool-a" });
      expect(activity().status).toBe("processing");
      ingest("SubagentStop", { agentInstanceId: "child-a" });
      expect(activity()).toMatchObject({ status: "ready", subagentCount: 0 });
      expect(activity()).not.toHaveProperty("turnResult");
    } finally {
      aggregator.dispose();
    }
  });

  it("晚到的旧空闲不能盖过同回合的新进展或其他回合", () => {
    const { aggregator, activity, ingest } = setup();
    try {
      const now = Date.now();
      ingest("PromptSubmit", { ts: now, turnId: "turn-a" });
      ingest("ActivityIdle", { ts: now + 10, turnId: "turn-a" });
      ingest("running", { ts: now + 30, turnId: "turn-a" });
      expect(ingest("ActivityIdle", { ts: now + 20, turnId: "turn-a" })).toBe(
        false
      );
      expect(activity().status).toBe("processing");
      expect(ingest("ActivityIdle", { ts: now + 40, turnId: "foreign" })).toBe(
        false
      );
      expect(activity().status).toBe("processing");
    } finally {
      aggregator.dispose();
    }
  });

  it("普通 Stop 仍只是候选，没有主会话时空闲不能创建状态", () => {
    const { aggregator, activity, ingest } = setup();
    try {
      expect(ingest("ActivityIdle")).toBe(false);
      expect(aggregator.snapshot().activities).toEqual([]);
      ingest("PromptSubmit");
      ingest("Stop");
      expect(activity().status).toBe("processing");
    } finally {
      aggregator.dispose();
    }
  });

  it("同一回合晚到的提问不能抹掉更新的空闲事实", () => {
    const { aggregator, activity, ingest } = setup();
    try {
      const ts = Date.now();
      ingest("PromptSubmit", { ts, turnId: "turn-a" });
      ingest("ActivityIdle", { ts: ts + 20, turnId: "turn-a" });
      ingest("PromptSubmit", { ts: ts + 10, turnId: "turn-a" });
      expect(activity().status).toBe("ready");
      expect(activity()).not.toHaveProperty("turnResult");
    } finally {
      aggregator.dispose();
    }
  });

  it("并列会话的空闲投影不借用另一个会话的完成结果", () => {
    const { aggregator, activity, ingest } = setup();
    try {
      ingest("PromptSubmit", { turnId: "turn-a" });
      ingest("TurnCompleted", { turnId: "turn-a" });
      ingest("PromptSubmit", { sessionId: "second", turnId: "turn-b" });
      expect(activity().status).toBe("processing");
      expect(activity()).not.toHaveProperty("turnResult");
      ingest("ActivityIdle", { sessionId: "second", turnId: "turn-b" });
      expect(activity().status).toBe("ready");
      expect(activity()).not.toHaveProperty("turnResult");
    } finally {
      aggregator.dispose();
    }
  });

  it("空闲不发完成通知，之后真正的终态即使仍为 ready 也通知一次", async () => {
    const { aggregator, ingest } = setup();
    const reports: NotificationReport[] = [];
    const attention = createAgentAttentionService({
      ingestNotification: (report) => reports.push(report),
    });
    try {
      ingest("PromptSubmit", { turnId: "turn-a" });
      const busy = aggregator.snapshot();
      ingest("ActivityIdle", { turnId: "turn-a" });
      const idle = aggregator.snapshot();
      await attention.observe(busy, idle);
      expect(reports).toEqual([]);
      ingest("TurnCompleted", { turnId: "turn-a" });
      const done = aggregator.snapshot();
      expect(done.activities[0]).toMatchObject({
        status: "ready",
        turnResult: "completed",
      });
      await attention.observe(idle, done);
      expect(reports).toHaveLength(1);
      expect(reports[0]?.kind).toBe("agent.turn-finished");
      await attention.observe(done, aggregator.snapshot());
      expect(reports).toHaveLength(1);
    } finally {
      aggregator.dispose();
    }
  });

  it.each([
    ["TurnInterrupted", "interrupted", "ready"],
    ["error", "failed", "error"],
  ])("%s 保存真实结果，新回合清除结果", (event, result, status) => {
    const { aggregator, activity, ingest } = setup();
    try {
      ingest("PromptSubmit", { turnId: "turn-a" });
      ingest(event, { turnId: "turn-a" });
      expect(activity()).toMatchObject({ status, turnResult: result });
      ingest("PromptSubmit", { turnId: "turn-b" });
      expect(activity()).not.toHaveProperty("turnResult");
      expect(activity().status).toBe("processing");
    } finally {
      aggregator.dispose();
    }
  });
});
