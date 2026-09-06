import {
  type AgentHookEventSinks,
  handleObservedAgentHookEvent,
} from "@main/ipc/foreground-activity/hook-pipeline.ts";
import { claudeIntegration } from "@main/services/agents/integrations/claude.ts";
import { createForegroundActivityAggregator } from "@main/services/foreground-activity/aggregator.ts";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent/session.ts";
import { expect, it } from "vitest";

it("Prompt 等待对账被工具超越后，仍确认同回合主身份且不清工具", async () => {
  const aggregator = createForegroundActivityAggregator({ now: () => 200 });
  const options = {
    evidenceSource: "hook",
    stopAuthority: "advisory",
    turnStartAuthority: "none",
  } as const;
  let release = () => {};
  const observing = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sinks: AgentHookEventSinks = {
    aggregator,
    applySessionTitle: async () => {},
    notifyListeners() {},
    observeTranscript: async (event) => {
      if (event.event === "PromptSubmit") await observing;
    },
    recordResume() {},
    resolveRuntime: () => claudeIntegration.runtime,
  };
  const event = (
    name: "PromptSubmit" | "ToolStart" | "TurnCompleted",
    ts: number,
    turnId = "main"
  ): AgentHookEventPayloadV3 => ({
    agent: "claude",
    kind: "agentEvent",
    v: 3,
    event: name,
    nativeEvent: name,
    panelId: "p1",
    windowId: "w1",
    sessionId: "session",
    toolUseId: "tool",
    turnId,
    ts,
  });
  const pendingPrompt = handleObservedAgentHookEvent(
    sinks,
    event("PromptSubmit", 100)
  );
  try {
    await handleObservedAgentHookEvent(sinks, event("ToolStart", 120));
    release();
    await pendingPrompt;
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      status: "tool",
    });
    expect(
      aggregator.ingestAgentEvent(event("ToolStart", 130, "foreign"), options)
    ).toBe(false);
    expect(
      aggregator.ingestAgentEvent(event("TurnCompleted", 140), options)
    ).toBe(true);
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      status: "ready",
    });
  } finally {
    release();
    await pendingPrompt;
    aggregator.dispose();
  }
});
