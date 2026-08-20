import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { describe, expect, it } from "vitest";
import { emitTranscriptEvent } from "../../../../../src/main/services/agents/integrations/transcript/tail-event.ts";

function emptyState() {
  return {
    contextsByTurnId: new Map<string, AgentHookEventPayload>(),
    pendingRecords: [],
    seenTerminalEvents: new Set<string>(),
    seenTranscriptEvents: new Set<string>(),
  };
}

function context(turnId: string): AgentHookEventPayload {
  return {
    agent: "cursor",
    event: "PromptSubmit",
    kind: "agentEvent",
    panelId: "p1",
    sessionId: "prompt",
    turnId,
    v: 1,
    windowId: "1",
  };
}

describe("emitTranscriptEvent", () => {
  it("fills emitted turnId from context but does not dedupe empty native terminals", () => {
    const received: AgentHookEventPayload[] = [];
    const state = emptyState();
    const ctx = context("92c079e3-84b1-4982-8c8a-aaaaaaaaaaa1");
    emitTranscriptEvent(
      state,
      ctx,
      {
        nativeEvent: "cursor.transcript.turn_ended",
        pierEvent: "TurnCompleted",
        turnId: "",
      },
      (event) => received.push(event)
    );
    emitTranscriptEvent(
      state,
      ctx,
      {
        nativeEvent: "cursor.transcript.turn_ended.aborted",
        pierEvent: "TurnInterrupted",
        turnId: "",
      },
      (event) => received.push(event)
    );
    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({
      event: "TurnCompleted",
      turnId: "92c079e3-84b1-4982-8c8a-aaaaaaaaaaa1",
    });
    expect(received[1]).toMatchObject({
      event: "TurnInterrupted",
      turnId: "92c079e3-84b1-4982-8c8a-aaaaaaaaaaa1",
    });
  });

  it("still dedupes terminals that carry a native turnId", () => {
    const received: AgentHookEventPayload[] = [];
    const state = emptyState();
    const ctx = context("context-turn");
    const record = {
      nativeEvent: "codex.transcript.turn_completed",
      pierEvent: "TurnCompleted" as const,
      turnId: "native-turn",
    };
    emitTranscriptEvent(state, ctx, record, (event) => received.push(event));
    emitTranscriptEvent(state, ctx, record, (event) => received.push(event));
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ turnId: "native-turn" });
  });
});
