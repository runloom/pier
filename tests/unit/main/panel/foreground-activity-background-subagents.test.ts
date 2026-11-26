import type {
  AgentHookEventPayload,
  AgentHookEventPayloadV1,
} from "@shared/contracts/agent/session.ts";
import type { AgentActivity } from "@shared/contracts/foreground-activity.ts";
import { describe, expect, it } from "vitest";
import { createForegroundActivityAggregator } from "../../../../src/main/services/foreground-activity/aggregator.ts";
import type { AgentEventIngestOptions } from "../../../../src/main/services/foreground-activity/types.ts";

const HOOK: AgentEventIngestOptions = {
  evidenceSource: "hook",
  stopAuthority: "authoritative",
  turnStartAuthority: "none",
};

const TRANSCRIPT: AgentEventIngestOptions = {
  evidenceSource: "transcript",
  stopAuthority: "authoritative",
  turnStartAuthority: "none",
};

const PARENT_SESSION = "parent-session";

function event(
  eventName: string,
  details: Partial<AgentHookEventPayloadV1> = {}
): AgentHookEventPayload {
  return {
    agent: "claude",
    event: eventName,
    kind: "agentEvent",
    panelId: "panel-1",
    sessionId: PARENT_SESSION,
    v: 1,
    windowId: "window-1",
    ...details,
  };
}

function subagentEvent(
  eventName: "SubagentStart" | "SubagentStop",
  details: Partial<AgentHookEventPayloadV1> = {}
): AgentHookEventPayload {
  // Claude 子智能体事件只带 parentSessionId（sessionId 为 None）。
  return event(eventName, {
    actorHint: "subagent",
    parentSessionId: PARENT_SESSION,
    sessionId: undefined,
    ...details,
  } as Partial<AgentHookEventPayloadV1>);
}

function activityOf(
  aggregator: ReturnType<typeof createForegroundActivityAggregator>
): AgentActivity {
  return aggregator.snapshot().activities[0] as AgentActivity;
}

/**
 * Claude async 子智能体：父回合已被 transcript 终态封账，子工作仍在跑。
 * 实测一个父回合的 9 个 SubagentStop 会跨 5 个不同 turnId、延续 20 分钟以上。
 */
function sealParentTurnWithRunningSubagents() {
  const aggregator = createForegroundActivityAggregator();
  aggregator.ingestAgentEvent(
    event("PromptSubmit", { turnId: "turn-1" }),
    HOOK
  );
  aggregator.ingestAgentEvent(
    subagentEvent("SubagentStart", { agentInstanceId: "worker-1" }),
    HOOK
  );
  aggregator.ingestAgentEvent(
    subagentEvent("SubagentStart", { agentInstanceId: "worker-2" }),
    HOOK
  );
  aggregator.ingestAgentEvent(
    event("TurnCompleted", { turnId: "turn-1" }),
    TRANSCRIPT
  );
  return aggregator;
}

describe("封账后仍在运行的后台子智能体", () => {
  it("父回合封账后仍有子工作时不回到 ready", () => {
    const aggregator = sealParentTurnWithRunningSubagents();
    const activity = activityOf(aggregator);
    expect(activity.subagentCount).toBe(2);
    expect(activity.status).toBe("processing");
    aggregator.dispose();
  });

  it("封账后的 SubagentStop 按实例身份结算，最后一个结束后回到 ready", () => {
    const aggregator = sealParentTurnWithRunningSubagents();
    expect(
      aggregator.ingestAgentEvent(
        subagentEvent("SubagentStop", { agentInstanceId: "worker-1" }),
        HOOK
      )
    ).toBe(true);
    let activity = activityOf(aggregator);
    expect(activity.subagentCount).toBe(1);
    expect(activity.status).toBe("processing");

    expect(
      aggregator.ingestAgentEvent(
        subagentEvent("SubagentStop", { agentInstanceId: "worker-2" }),
        HOOK
      )
    ).toBe(true);
    activity = activityOf(aggregator);
    expect(activity.subagentCount).toBe(0);
    expect(activity.status).toBe("ready");
    aggregator.dispose();
  });

  it("封账后的 SubagentStop 可以带封账回合之外的回合号", () => {
    // 实测同一个父回合的 9 个 SubagentStop 跨 5 个不同 turnId 到达。
    const aggregator = sealParentTurnWithRunningSubagents();
    expect(
      aggregator.ingestAgentEvent(
        subagentEvent("SubagentStop", {
          agentInstanceId: "worker-1",
          turnId: "turn-later",
        }),
        HOOK
      )
    ).toBe(true);
    const activity = activityOf(aggregator);
    expect(activity.subagentCount).toBe(1);
    expect(activity.status).toBe("processing");
    aggregator.dispose();
  });

  it("封账后迟到的 SubagentStart 不把已封账回合拖回忙碌", () => {
    const aggregator = sealParentTurnWithRunningSubagents();
    expect(
      aggregator.ingestAgentEvent(
        subagentEvent("SubagentStart", { agentInstanceId: "worker-3" }),
        HOOK
      )
    ).toBe(false);
    const activity = activityOf(aggregator);
    expect(activity.subagentCount).toBe(2);
    expect(activity.status).toBe("processing");
    aggregator.dispose();
  });

  it("没有子工作时封账立即回到 ready", () => {
    const aggregator = createForegroundActivityAggregator();
    aggregator.ingestAgentEvent(
      event("PromptSubmit", { turnId: "turn-1" }),
      HOOK
    );
    aggregator.ingestAgentEvent(
      event("TurnCompleted", { turnId: "turn-1" }),
      TRANSCRIPT
    );
    const activity = activityOf(aggregator);
    expect(activity.subagentCount).toBe(0);
    expect(activity.status).toBe("ready");
    aggregator.dispose();
  });

  it("封账保留子工作但退休父回合自己的工具与交互", () => {
    const aggregator = createForegroundActivityAggregator();
    aggregator.ingestAgentEvent(
      event("PromptSubmit", { turnId: "turn-1" }),
      HOOK
    );
    aggregator.ingestAgentEvent(
      event("ToolStart", { toolUseId: "tool-1", turnId: "turn-1" }),
      HOOK
    );
    aggregator.ingestAgentEvent(
      subagentEvent("SubagentStart", { agentInstanceId: "worker-1" }),
      HOOK
    );
    aggregator.ingestAgentEvent(
      event("TurnCompleted", { turnId: "turn-1" }),
      TRANSCRIPT
    );
    const activity = activityOf(aggregator);
    expect(activity.subagentCount).toBe(1);
    expect(activity.status).toBe("processing");
    aggregator.dispose();
  });

  it("新回合换代仍退休旧子工作关联，新回合自己显示 processing", () => {
    const aggregator = sealParentTurnWithRunningSubagents();
    aggregator.ingestAgentEvent(
      event("PromptSubmit", { turnId: "turn-2" }),
      HOOK
    );
    const activity = activityOf(aggregator);
    expect(activity.subagentCount).toBe(0);
    expect(activity.status).toBe("processing");
    // 换代后的迟到 SubagentStop 不再入账，也不会把计数减成负数。
    expect(
      aggregator.ingestAgentEvent(
        subagentEvent("SubagentStop", { agentInstanceId: "worker-1" }),
        HOOK
      )
    ).toBe(false);
    expect(activityOf(aggregator).subagentCount).toBe(0);
    aggregator.dispose();
  });
});
