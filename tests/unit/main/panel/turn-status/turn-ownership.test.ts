import { createForegroundActivityAggregator } from "@main/services/foreground-activity/aggregator.ts";
import type { AgentEventIngestOptions } from "@main/services/foreground-activity/types.ts";
import type { AgentHookEventPayloadV1 } from "@shared/contracts/agent/session.ts";
import type { AgentActivity } from "@shared/contracts/foreground-activity.ts";
import { describe, expect, it } from "vitest";

function setup() {
  const aggregator = createForegroundActivityAggregator();
  const ingest = (
    name: string,
    turnId?: string,
    options: Partial<AgentEventIngestOptions> = {},
    sessionId = "main"
  ) => {
    const event: AgentHookEventPayloadV1 = {
      agent: "claude",
      event: name,
      kind: "agentEvent",
      panelId: "panel-1",
      sessionId,
      toolUseId: `tool-${turnId ?? "anonymous"}`,
      turnId,
      v: 1,
      windowId: "window-1",
    };
    return aggregator.ingestAgentEvent(event, {
      evidenceSource: "hook",
      stopAuthority: "authoritative",
      turnStartAuthority: "none",
      ...options,
    });
  };
  const status = () =>
    (aggregator.snapshot().activities[0] as AgentActivity).status;
  return { aggregator, ingest, status };
}

describe("终态必须属于当前主回合", () => {
  it.each([
    "a",
    "foreign-child",
    undefined,
  ])("匿名恢复后旧终态 %s 不得收尾，新鲜主终态仍可确认身份", (lateId) => {
    let at = 100;
    const aggregator = createForegroundActivityAggregator({ now: () => at });
    const ingestEvent = (
      name: string,
      ts: number,
      turnId?: string,
      source: "hook" | "transcript" = "hook"
    ) =>
      aggregator.ingestAgentEvent(
        {
          agent: "claude",
          kind: "agentEvent",
          v: 1,
          event: name,
          panelId: "panel-1",
          windowId: "window-1",
          sessionId: "main",
          ts,
          turnId,
          toolUseId: "new-tool",
        },
        {
          evidenceSource: source,
          stopAuthority: "authoritative",
          turnStartAuthority: "none",
        }
      );
    try {
      ingestEvent("PromptSubmit", 100, "a");
      at = 200;
      ingestEvent("TurnCompleted", 200, "a", "transcript");
      at = 300;
      expect(ingestEvent("ToolStart", 300)).toBe(true);
      at = 400;
      expect(ingestEvent("TurnInterrupted", 150, lateId)).toBe(false);
      expect(aggregator.snapshot().activities[0]).toMatchObject({
        status: "tool",
      });
      expect(ingestEvent("TurnCompleted", 400, "b", "transcript")).toBe(true);
      expect(aggregator.snapshot().activities[0]).toMatchObject({
        status: "ready",
      });
    } finally {
      aggregator.dispose();
    }
  });

  it("没有 PromptSubmit 不能证明另一个会话属于主回合", () => {
    const { aggregator, ingest, status } = setup();
    try {
      ingest("PromptSubmit");
      ingest("ToolStart", "parallel-turn", {}, "parallel-session");
      ingest("TurnCompleted");
      expect(status()).toBe("tool");
    } finally {
      aggregator.dispose();
    }
  });

  it.each([
    "TurnCompleted",
    "TurnInterrupted",
    "error",
  ])("未见过的外来 %s 不能结算当前已知回合", (terminal) => {
    const { aggregator, ingest, status } = setup();
    try {
      ingest("PromptSubmit", "main-a");
      ingest("ToolStart", "main-a");
      expect(ingest(terminal, "child-b")).toBe(false);
      expect(status()).toBe("tool");
      expect(ingest("TurnCompleted", "main-a")).toBe(true);
      expect(status()).toBe("ready");
    } finally {
      aggregator.dispose();
    }
  });

  it.each([
    "TurnCompleted",
    "TurnInterrupted",
    "error",
  ])("无 PromptSubmit 的连续回合也拒绝上一轮迟到的 %s", (terminal) => {
    const { aggregator, ingest, status } = setup();
    try {
      ingest("ToolStart", "a");
      expect(ingest("ToolStart", "b")).toBe(true);
      expect(ingest(terminal, "a")).toBe(false);
      expect(status()).toBe("tool");
      expect(ingest("TurnCompleted", "b")).toBe(true);
      expect(status()).toBe("ready");
    } finally {
      aggregator.dispose();
    }
  });

  it.each([
    "ToolStart",
    "processing",
    "running",
    "InteractionRequested",
  ])("外来 %s 不得替换明确建立的主回合，随后子终态也无结算权", (progress) => {
    const { aggregator, ingest, status } = setup();
    try {
      ingest("PromptSubmit", "main-a");
      expect(ingest(progress, "child-b")).toBe(false);
      expect(ingest("TurnCompleted", "child-b")).toBe(false);
      expect(status()).toBe("processing");
      expect(ingest("TurnCompleted", "main-a")).toBe(true);
      expect(status()).toBe("ready");
    } finally {
      aggregator.dispose();
    }
  });

  it("软封后匿名工具不冒充旧回合身份，允许适配器确认的新主终态", () => {
    const { aggregator, ingest, status } = setup();
    try {
      ingest("PromptSubmit", "0");
      ingest("TurnCompleted", "0", { evidenceSource: "transcript" });
      expect(ingest("ToolStart")).toBe(true);
      expect(status()).toBe("tool");
      expect(
        ingest("TurnCompleted", "1", { evidenceSource: "transcript" })
      ).toBe(true);
      expect(status()).toBe("ready");
    } finally {
      aggregator.dispose();
    }
  });
});
