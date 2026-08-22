import { describe, expect, it } from "vitest";
import {
  CODEX_RESET_CREDITS_METRIC_ID,
  parseCodexResetCredits,
} from "../../../../../packages/plugin-codex/src/main/codex-reset-credits.ts";

describe("parseCodexResetCredits", () => {
  it("reads available_count from the dedicated endpoint payload", () => {
    expect(
      parseCodexResetCredits({
        available_count: 3,
        credits: [
          { status: "available", title: "Full reset (Weekly + 5 hr)" },
          { status: "available" },
          { status: "expired" },
        ],
      })
    ).toEqual([
      {
        format: "count",
        id: CODEX_RESET_CREDITS_METRIC_ID,
        kind: "scalar",
        value: 3,
      },
    ]);
  });

  it("counts available credits when available_count is omitted", () => {
    expect(
      parseCodexResetCredits({
        credits: [
          { status: "available" },
          { status: "available" },
          { status: "used" },
        ],
      })
    ).toEqual([
      {
        format: "count",
        id: CODEX_RESET_CREDITS_METRIC_ID,
        kind: "scalar",
        value: 2,
      },
    ]);
  });

  it("reads a nested usage payload without inventing a zero badge", () => {
    expect(
      parseCodexResetCredits({
        rate_limit_reset_credits: { available_count: 0 },
      })
    ).toEqual([]);
    expect(
      parseCodexResetCredits({
        rateLimitResetCredits: { availableCount: 1 },
      })
    ).toEqual([
      {
        format: "count",
        id: CODEX_RESET_CREDITS_METRIC_ID,
        kind: "scalar",
        value: 1,
      },
    ]);
  });
});
