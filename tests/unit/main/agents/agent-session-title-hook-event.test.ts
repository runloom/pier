import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { describe, expect, it, vi } from "vitest";
import { applyAgentSessionTitleFromHookEvent } from "../../../../src/main/services/agents/session-title/index.ts";
import type { ForegroundActivityAggregator } from "../../../../src/main/services/foreground-activity/types.ts";

function promptEvent(): AgentHookEventPayload {
  return {
    agent: "claude",
    event: "PromptSubmit",
    kind: "agentEvent",
    nativeEvent: "UserPromptSubmit",
    panelId: "panel-1",
    promptSnippet: "fix the parser",
    v: 3,
    windowId: "1",
  };
}

describe("agent session title hook events", () => {
  it("PromptSubmit 不再从首条 prompt 写 sessionTitle（tab 走 OSC / cwd）", async () => {
    const aggregator = {
      setAgentSessionTitle: vi.fn(),
      hydrateAgentSessionTitle: vi.fn(),
      clearAgentSessionTitle: vi.fn(),
    } as unknown as ForegroundActivityAggregator;

    await applyAgentSessionTitleFromHookEvent({
      aggregator,
      event: promptEvent(),
    });

    expect(aggregator.setAgentSessionTitle).not.toHaveBeenCalled();
    expect(aggregator.hydrateAgentSessionTitle).not.toHaveBeenCalled();
  });
});
