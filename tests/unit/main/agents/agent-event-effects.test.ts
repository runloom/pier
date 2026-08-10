import type { AgentHookEventPayloadV2 } from "@shared/contracts/agent/session.ts";
import { describe, expect, it } from "vitest";
import { effectsForAcceptedAgentEvent } from "../../../../src/main/services/agents/event-effects.ts";

function event(
  overrides: Partial<AgentHookEventPayloadV2> = {}
): AgentHookEventPayloadV2 {
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

  it("主会话 ToolComplete 仍应 persistResume（与 FA accept 解耦）", () => {
    expect(
      effectsForAcceptedAgentEvent(
        event({
          event: "ToolComplete",
          nativeEvent: "PostToolUse",
          sessionId: "codex-session",
        })
      ).persistResume
    ).toBe(true);
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
