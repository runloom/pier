import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent/session.ts";
import type { AgentActivity } from "@shared/contracts/foreground-activity.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ompIntegration } from "../../../../src/main/services/agents/integrations/omp.ts";
import { resolveAgentEventIngestOptions } from "../../../../src/main/services/agents/integrations/runtime/event-authority.ts";
import { createForegroundActivityAggregator } from "../../../../src/main/services/foreground-activity/aggregator.ts";

function ompEvent(
  event: AgentHookEventPayloadV3["event"],
  nativeEvent: string,
  extra: Partial<AgentHookEventPayloadV3> = {}
): AgentHookEventPayloadV3 {
  return {
    v: 3,
    kind: "agentEvent",
    agent: "omp",
    event,
    nativeEvent,
    panelId: "terminal-1786638500087",
    windowId: "1",
    sessionId: "019ffbf4-093b-7000-a533-e37f1f6d0ea3",
    ...extra,
  } as AgentHookEventPayloadV3;
}

function ingest(
  agg: ReturnType<typeof createForegroundActivityAggregator>,
  event: AgentHookEventPayloadV3
): boolean {
  return agg.ingestAgentEvent(
    event,
    resolveAgentEventIngestOptions({
      evidenceSource: "hook",
      event,
      runtime: ompIntegration.runtime,
    })
  );
}

describe("omp live hook sequence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("SessionStart then PromptSubmit is accepted and projects hook processing", () => {
    const agg = createForegroundActivityAggregator();
    agg.agentLaunched("1", "terminal-1786638500087", "omp");
    vi.advanceTimersByTime(250);

    expect(ingest(agg, ompEvent("SessionStart", "session_start"))).toBe(true);
    expect(
      ingest(
        agg,
        ompEvent("PromptSubmit", "before_agent_start", {
          promptSnippet: "你好",
        })
      )
    ).toBe(true);

    const activity = agg.snapshot("1").activities[0] as AgentActivity;
    expect(activity.kind).toBe("agent");
    expect(activity.agentId).toBe("omp");
    expect(activity.source).toBe("hook");
    expect(activity.status).toBe("processing");
    agg.dispose();
  });

  it("wrapper OSC 133 does not erase omp launch before PromptSubmit", () => {
    const agg = createForegroundActivityAggregator();
    const panelId = "terminal-1786638500087";
    agg.agentLaunched("1", panelId, "omp");
    ingest(agg, ompEvent("SessionStart", "session_start"));

    agg.ingestCommandStarted(
      panelId,
      "1",
      "/bin/sh -c 'set -m; /Users/sheep/.bun/bin/omp'",
      null
    );
    agg.ingestCommandFinished(panelId, 0, "1");
    vi.advanceTimersByTime(250);

    const afterWrap = agg.snapshot("1").activities[0] as AgentActivity;
    expect(afterWrap.kind).toBe("agent");
    expect(afterWrap.agentId).toBe("omp");
    expect(afterWrap.source).toBe("hook");

    expect(
      ingest(
        agg,
        ompEvent("PromptSubmit", "before_agent_start", {
          promptSnippet: "你好",
        })
      )
    ).toBe(true);
    const activity = agg.snapshot("1").activities[0] as AgentActivity;
    expect(activity.kind).toBe("agent");
    expect(activity.agentId).toBe("omp");
    expect(activity.source).toBe("hook");
    expect(activity.status).toBe("processing");
    agg.dispose();
  });
});
