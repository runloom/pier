import type { AgentHookEventPayloadV1 } from "@shared/contracts/agent/session.ts";
import type { AgentActivity } from "@shared/contracts/foreground-activity.ts";
import { describe, expect, it } from "vitest";
import { createForegroundActivityAggregator } from "../../../../src/main/services/foreground-activity/aggregator.ts";
import { hookEventTimeMs } from "../../../../src/main/services/foreground-activity/turn-unseal.ts";
import type {
  AgentEventIngestOptions,
  ForegroundActivityAggregator,
} from "../../../../src/main/services/foreground-activity/types.ts";

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

function event(
  eventName: string,
  details: Partial<AgentHookEventPayloadV1> = {}
) {
  return {
    agent: "claude" as const,
    event: eventName,
    kind: "agentEvent" as const,
    panelId: "panel-1",
    v: 1 as const,
    windowId: "window-1",
    ...details,
  };
}

function ingest(
  aggregator: ForegroundActivityAggregator,
  hookEvent: ReturnType<typeof event>,
  options: AgentEventIngestOptions
): boolean {
  return aggregator.ingestAgentEvent(hookEvent, options);
}

function statusOf(
  aggregator: ForegroundActivityAggregator
): AgentActivity["status"] | undefined {
  return (aggregator.snapshot().activities[0] as AgentActivity | undefined)
    ?.status;
}

describe("transcript 软封解封", () => {
  it("hook 纳秒 ts 收到毫秒再与 Date.now 封账时间比较", () => {
    const at = 1_700_000_000_000;
    expect(
      hookEventTimeMs(event("ToolStart", { ts: at * 1_000_000 }), at)
    ).toBe(at);
    expect(hookEventTimeMs(event("ToolStart", { ts: at }), 0)).toBe(at);
    expect(hookEventTimeMs(event("ToolStart"), at)).toBe(at);
  });
  it("transcript 软封可被同回合新鲜 hook ToolStart 解封", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }), HOOK);
    expect(
      ingest(
        aggregator,
        event("TurnCompleted", { turnId: "turn-1" }),
        TRANSCRIPT
      )
    ).toBe(true);
    expect(statusOf(aggregator)).toBe("ready");
    expect(
      ingest(
        aggregator,
        event("ToolStart", { toolUseId: "tool-1", turnId: "turn-1" }),
        HOOK
      )
    ).toBe(true);
    expect(statusOf(aggregator)).toBe("tool");
    aggregator.dispose();
  });

  it("hook 硬封不能被 ToolStart 解封", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }), HOOK);
    expect(
      ingest(aggregator, event("TurnCompleted", { turnId: "turn-1" }), HOOK)
    ).toBe(true);
    expect(statusOf(aggregator)).toBe("ready");
    expect(
      ingest(
        aggregator,
        event("ToolStart", { toolUseId: "tool-1", turnId: "turn-1" }),
        HOOK
      )
    ).toBe(false);
    expect(statusOf(aggregator)).toBe("ready");
    aggregator.dispose();
  });

  it("transcript 软封后新回合 ToolStart 认领新 turnId，不解封旧回合", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }), HOOK);
    ingest(
      aggregator,
      event("TurnCompleted", { turnId: "turn-1" }),
      TRANSCRIPT
    );
    expect(
      ingest(
        aggregator,
        event("ToolStart", { toolUseId: "tool-2", turnId: "turn-2" }),
        HOOK
      )
    ).toBe(true);
    expect(statusOf(aggregator)).toBe("tool");
    aggregator.dispose();
  });

  it("封账之前的 hook 工具事件不解封", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }), HOOK);
    ingest(
      aggregator,
      event("TurnCompleted", { turnId: "turn-1" }),
      TRANSCRIPT
    );
    expect(
      ingest(
        aggregator,
        event("ToolStart", {
          toolUseId: "stale",
          ts: 1,
          turnId: "turn-1",
        }),
        HOOK
      )
    ).toBe(false);
    expect(statusOf(aggregator)).toBe("ready");
    aggregator.dispose();
  });

  it("transcript 来源的 ToolStart 不解封", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }), HOOK);
    ingest(
      aggregator,
      event("TurnCompleted", { turnId: "turn-1" }),
      TRANSCRIPT
    );
    expect(
      ingest(
        aggregator,
        event("ToolStart", { toolUseId: "tool-1", turnId: "turn-1" }),
        TRANSCRIPT
      )
    ).toBe(false);
    expect(statusOf(aggregator)).toBe("ready");
    aggregator.dispose();
  });

  it("hook ToolComplete 不解封 transcript 软封", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }), HOOK);
    ingest(
      aggregator,
      event("TurnCompleted", { turnId: "turn-1" }),
      TRANSCRIPT
    );
    expect(
      ingest(
        aggregator,
        event("ToolComplete", { toolUseId: "tool-1", turnId: "turn-1" }),
        HOOK
      )
    ).toBe(false);
    expect(statusOf(aggregator)).toBe("ready");
    aggregator.dispose();
  });

  it("生产形态纳秒 ts 的新鲜 ToolStart 仍解封", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }), HOOK);
    ingest(
      aggregator,
      event("TurnCompleted", { turnId: "turn-1" }),
      TRANSCRIPT
    );
    expect(
      ingest(
        aggregator,
        event("ToolStart", {
          toolUseId: "tool-1",
          ts: (Date.now() + 5000) * 1_000_000,
          turnId: "turn-1",
        }),
        HOOK
      )
    ).toBe(true);
    expect(statusOf(aggregator)).toBe("tool");
    aggregator.dispose();
  });

  it("宿主合成终态是硬封，ToolStart 不解封", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }), HOOK);
    expect(
      ingest(aggregator, event("TurnInterrupted", { turnId: "turn-1" }), {
        evidenceSource: "host",
        stopAuthority: "authoritative",
        turnStartAuthority: "none",
      })
    ).toBe(true);
    expect(statusOf(aggregator)).toBe("ready");
    expect(
      ingest(
        aggregator,
        event("ToolStart", { toolUseId: "tool-1", turnId: "turn-1" }),
        HOOK
      )
    ).toBe(false);
    expect(statusOf(aggregator)).toBe("ready");
    aggregator.dispose();
  });
});
