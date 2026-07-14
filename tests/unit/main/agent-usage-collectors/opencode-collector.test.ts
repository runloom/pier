import { mergeOpenCodeInputs } from "@main/services/agents/usage-collectors/opencode-merge.ts";
import type {
  UsageDataPublishInput,
  UsageTokenObservation,
} from "@pier/plugin-api/main";
import { describe, expect, it } from "vitest";

function observation(eventId: string): UsageTokenObservation {
  return {
    cachedInputTokens: 10,
    date: "2026-07-13",
    eventId,
    inputTokens: 100,
    modelId: "gpt-4o",
    outputTokens: 20,
  };
}

function input(observations: UsageTokenObservation[]): UsageDataPublishInput {
  return {
    coverage: { complete: true, from: "2026-07-13", to: "2026-07-13" },
    observations,
    observedAt: 1,
    scope: { kind: "machine" },
    sourceId: "opencode-local-sessions",
  };
}

describe("OpenCode collector merge", () => {
  it("preserves distinct primary calls with identical token counts", () => {
    const merged = mergeOpenCodeInputs(
      input([observation("message-a"), observation("message-b")]),
      input([observation("message-a"), observation("message-c")])
    );
    expect(merged?.observations.map((row) => row.eventId)).toEqual([
      "message-a",
      "message-b",
      "message-c",
    ]);
  });
});
