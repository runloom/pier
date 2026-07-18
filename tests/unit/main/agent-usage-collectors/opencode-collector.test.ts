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

  it("drops observations outside the intersected coverage window", () => {
    const primary = input([
      {
        ...observation("message-a"),
        date: "2026-07-13",
      },
      {
        ...observation("message-old"),
        date: "2026-07-01",
      },
    ]);
    primary.coverage = { complete: true, from: "2026-07-10", to: "2026-07-17" };
    const secondary = input([
      {
        ...observation("message-b"),
        date: "2026-07-15",
      },
      {
        ...observation("message-future"),
        date: "2026-07-20",
      },
    ]);
    secondary.coverage = {
      complete: true,
      from: "2026-07-12",
      to: "2026-07-16",
    };

    const merged = mergeOpenCodeInputs(primary, secondary);

    expect(merged?.coverage).toEqual({
      complete: true,
      from: "2026-07-12",
      to: "2026-07-16",
    });
    expect(merged?.observations.map((row) => row.eventId)).toEqual([
      "message-a",
      "message-b",
    ]);
  });
});
