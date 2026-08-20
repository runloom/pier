import { describe, expect, it } from "vitest";
import {
  cursorTranscriptObserveTarget,
  isForeignBoundCursorSession,
  isStaleCursorSessionEnd,
  nextCursorBoundTranscript,
  shouldBindCursorTranscript,
} from "../../../../../src/main/services/agents/integrations/transcript/cursor-transcript-bind.ts";

describe("cursor transcript bind", () => {
  it("binds prompt and session start, not tools or closing hooks", () => {
    expect(shouldBindCursorTranscript("PromptSubmit")).toBe(true);
    expect(shouldBindCursorTranscript("SessionStart")).toBe(true);
    expect(shouldBindCursorTranscript("processing")).toBe(true);
    expect(shouldBindCursorTranscript("running")).toBe(true);
    expect(shouldBindCursorTranscript("Stop")).toBe(false);
    expect(shouldBindCursorTranscript("TurnCompleted")).toBe(false);
    expect(shouldBindCursorTranscript("SessionEnd")).toBe(false);
    expect(shouldBindCursorTranscript("ToolStart")).toBe(false);
    expect(shouldBindCursorTranscript("ToolComplete")).toBe(false);
  });

  it("keeps the prompt jsonl when a later tool or stop event resolves a different path", () => {
    const bound = nextCursorBoundTranscript({
      bound: undefined,
      event: { event: "PromptSubmit", sessionId: "prompt" },
      resolvedPath: "/tmp/prompt.jsonl",
    });
    expect(bound).toEqual({ path: "/tmp/prompt.jsonl", sessionId: "prompt" });
    expect(
      nextCursorBoundTranscript({
        bound,
        event: { event: "ToolStart", sessionId: "stale" },
        resolvedPath: "/tmp/stale.jsonl",
      })
    ).toEqual(bound);
    expect(
      nextCursorBoundTranscript({
        bound,
        event: { event: "Stop", sessionId: "stale" },
        resolvedPath: "/tmp/stale.jsonl",
      })
    ).toEqual(bound);
    expect(
      cursorTranscriptObserveTarget({
        bound,
        event: { event: "ToolStart", sessionId: "stale" },
        resolvedPath: "/tmp/stale.jsonl",
      })
    ).toEqual({ path: "/tmp/prompt.jsonl", sessionId: "prompt" });
    expect(
      cursorTranscriptObserveTarget({
        bound,
        event: { event: "Stop", sessionId: "stale" },
        resolvedPath: "/tmp/stale.jsonl",
      })
    ).toEqual({ path: "/tmp/prompt.jsonl", sessionId: "prompt" });
  });

  it("does not treat a stale conversation SessionEnd as the bound session", () => {
    expect(
      isForeignBoundCursorSession(
        { path: "/tmp/prompt.jsonl", sessionId: "prompt" },
        "stale"
      )
    ).toBe(true);
    expect(
      isForeignBoundCursorSession(
        { path: "/tmp/prompt.jsonl", sessionId: "prompt" },
        "prompt"
      )
    ).toBe(false);
    expect(
      isStaleCursorSessionEnd(
        { path: "/tmp/prompt.jsonl", sessionId: "prompt" },
        { event: "SessionEnd", sessionId: "stale" }
      )
    ).toBe(true);
    expect(
      isStaleCursorSessionEnd(
        { path: "/tmp/prompt.jsonl", sessionId: "prompt" },
        { event: "Stop", sessionId: "stale" }
      )
    ).toBe(false);
  });
});
