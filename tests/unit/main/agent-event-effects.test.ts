import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import { describe, expect, it } from "vitest";
import { effectsForAcceptedAgentEvent } from "../../../src/main/services/agents/agent-event-effects.ts";

function event(
  overrides: Partial<AgentHookEventPayload> = {}
): AgentHookEventPayload {
  return {
    agent: "opencode",
    event: "SessionEnd",
    kind: "agentEvent",
    nativeEvent: "session.deleted",
    panelId: "panel-1",
    sessionId: "session-child",
    v: 2,
    windowId: "1",
    ...overrides,
  };
}

describe("accepted agent event effects", () => {
  it("主会话可更新恢复信息、transcript owner 和面板退出状态", () => {
    expect(effectsForAcceptedAgentEvent(event())).toEqual({
      markPanelExited: true,
      observeTranscript: true,
      persistResume: true,
    });
  });

  it("子会话 SessionEnd 不产生任何面板级旁路效果", () => {
    expect(
      effectsForAcceptedAgentEvent(
        event({
          actorHint: "subagent",
          parentSessionId: "session-parent",
        })
      )
    ).toEqual({
      markPanelExited: false,
      observeTranscript: false,
      persistResume: false,
    });
  });
});
