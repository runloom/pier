import { createForegroundActivityAggregator } from "@main/services/foreground-activity/aggregator.ts";
import { HOOK_FRESH_TTL_MS } from "@main/services/foreground-activity/entry.ts";
import type { AgentEventIngestOptions } from "@main/services/foreground-activity/types.ts";
import type { AgentHookEventPayloadV1 } from "@shared/contracts/agent/session.ts";
import type { AgentActivity } from "@shared/contracts/foreground-activity.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const OPTIONS: AgentEventIngestOptions = {
  evidenceSource: "hook",
  stopAuthority: "advisory",
  turnStartAuthority: "none",
};

function setup() {
  const aggregator = createForegroundActivityAggregator();
  const ingest = (
    name: string,
    details: Partial<AgentHookEventPayloadV1> & { interactionId?: string } = {}
  ) =>
    aggregator.ingestAgentEvent(
      {
        agent: "claude",
        event: name,
        kind: "agentEvent",
        panelId: "panel-1",
        sessionId: "main",
        v: 1,
        windowId: "window-1",
        ...details,
      },
      OPTIONS
    );
  const activity = () => aggregator.snapshot().activities[0] as AgentActivity;
  return { activity, aggregator, ingest };
}

afterEach(() => vi.useRealTimers());

describe("候选结束不替代当前工作证据", () => {
  it("候选保留并发工具，最后一个工具结束后仍等待主回合完成", () => {
    const { activity, aggregator, ingest } = setup();
    try {
      ingest("PromptSubmit");
      ingest("ToolStart", { toolUseId: "a" });
      ingest("ToolStart", { toolUseId: "b" });
      ingest("Stop");
      expect(activity().status).toBe("tool");
      ingest("ToolComplete", { toolUseId: "a" });
      expect(activity().status).toBe("tool");
      ingest("ToolComplete", { toolUseId: "b" });
      expect(activity().status).toBe("processing");
      ingest("TurnCompleted");
      expect(activity().status).toBe("ready");
    } finally {
      aggregator.dispose();
    }
  });

  it("问答不会被候选或其他工具完成清空，回答后恢复仍在执行的工具", () => {
    const { activity, aggregator, ingest } = setup();
    try {
      ingest("PromptSubmit");
      ingest("ToolStart", { toolUseId: "background" });
      ingest("InteractionRequested", { interactionId: "question" });
      ingest("Stop");
      expect(activity().status).toBe("waiting");
      ingest("ToolComplete", { toolUseId: "unrelated" });
      expect(activity().status).toBe("waiting");
      ingest("InteractionResolved", { interactionId: "question" });
      expect(activity().status).toBe("tool");
    } finally {
      aggregator.dispose();
    }
  });

  it("子智能体结束只更新计数，候选之后主会话仍在处理", () => {
    const { activity, aggregator, ingest } = setup();
    try {
      ingest("PromptSubmit");
      ingest("SubagentStart", { agentInstanceId: "helper" });
      ingest("Stop");
      expect(activity()).toMatchObject({
        status: "processing",
        subagentCount: 1,
      });
      ingest("SubagentStop", { agentInstanceId: "helper" });
      expect(activity()).toMatchObject({
        status: "processing",
        subagentCount: 0,
      });
    } finally {
      aggregator.dispose();
    }
  });

  it("候选会话不能作为已结束会话压过 panel 中的工具", () => {
    const { activity, aggregator, ingest } = setup();
    try {
      ingest("PromptSubmit");
      ingest("ToolStart", { sessionId: undefined, toolUseId: "panel-tool" });
      expect(activity().status).toBe("tool");
      ingest("Stop");
      expect(activity().status).toBe("tool");
    } finally {
      aggregator.dispose();
    }
  });

  it.each([
    "Stop",
    "SubagentStart",
    "SubagentStop",
  ])("%s 不能延长主状态的可信期限，也不能恢复过期状态", (name) => {
    vi.useFakeTimers();
    const { activity, aggregator, ingest } = setup();
    try {
      ingest("PromptSubmit");
      ingest("SubagentStart", { agentInstanceId: "helper" });
      vi.advanceTimersByTime(HOOK_FRESH_TTL_MS - 1);
      ingest(name, { agentInstanceId: "helper" });
      vi.advanceTimersByTime(2);
      expect(activity().status).toBeUndefined();
      ingest(name, { agentInstanceId: "helper" });
      expect(activity().status).toBeUndefined();
    } finally {
      aggregator.dispose();
    }
  });
});
