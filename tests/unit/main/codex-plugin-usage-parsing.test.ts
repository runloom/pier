import { describe, expect, it } from "vitest";
import { parseRateLimitsResult } from "../../../packages/plugin-codex/src/main/codex-usage.ts";

describe("Codex App Server usage parsing", () => {
  it("preserves dynamic window durations and reset credits", () => {
    expect(
      parseRateLimitsResult({
        rateLimitResetCredits: { availableCount: 3 },
        rateLimits: {
          limitId: "codex",
          primary: { resetsAt: 100, usedPercent: 38, windowDurationMins: 300 },
          secondary: { usedPercent: 64, windowDurationMins: 10_080 },
        },
      })
    ).toEqual({
      resetCreditsAvailable: 3,
      status: "ok",
      windows: [
        {
          id: "codex:primary",
          limitId: "codex",
          resetsAt: 100_000,
          usedPercent: 38,
          windowMinutes: 300,
        },
        {
          id: "codex:secondary",
          limitId: "codex",
          usedPercent: 64,
          windowMinutes: 10_080,
        },
      ],
    });
  });

  it.each([
    [15, "codex:primary"],
    [300, "codex:primary"],
    [10_080, "codex:primary"],
    [43_200, "codex:primary"],
  ])("preserves a %i-minute primary window", (windowDurationMins, id) => {
    expect(
      parseRateLimitsResult({
        rateLimits: {
          primary: { usedPercent: 5, windowDurationMins },
          secondary: null,
        },
      }).windows
    ).toEqual([
      {
        id,
        limitId: "codex",
        usedPercent: 5,
        windowMinutes: windowDurationMins,
      },
    ]);
  });

  it("uses the multi-bucket view without duplicating the compatibility bucket", () => {
    expect(
      parseRateLimitsResult({
        rateLimits: {
          limitId: "codex",
          primary: { usedPercent: 99, windowDurationMins: 300 },
        },
        rateLimitsByLimitId: {
          review: {
            limitId: "review",
            limitName: "Code review",
            primary: { usedPercent: 43, windowDurationMins: 43_200 },
          },
          codex: {
            limitId: "codex",
            limitName: "Codex",
            primary: { usedPercent: 17, windowDurationMins: 540 },
          },
        },
      }).windows
    ).toEqual([
      {
        id: "codex:primary",
        limitId: "codex",
        limitName: "Codex",
        usedPercent: 17,
        windowMinutes: 540,
      },
      {
        id: "review:primary",
        limitId: "review",
        limitName: "Code review",
        usedPercent: 43,
        windowMinutes: 43_200,
      },
    ]);
  });

  it("places model-specific buckets after the compatibility bucket", () => {
    expect(
      parseRateLimitsResult({
        rateLimits: {
          limitId: "codex",
          primary: { usedPercent: 14, windowDurationMins: 300 },
        },
        rateLimitsByLimitId: {
          spark: {
            limitId: "spark",
            limitName: "GPT-5.3-Codex-Spark",
            primary: { usedPercent: 0, windowDurationMins: 300 },
            secondary: { usedPercent: 0, windowDurationMins: 10_080 },
          },
          codex: {
            limitId: "codex",
            primary: { usedPercent: 14, windowDurationMins: 300 },
            secondary: { usedPercent: 21, windowDurationMins: 10_080 },
          },
        },
      }).windows.map((window) => `${window.limitId}:${window.windowMinutes}`)
    ).toEqual(["codex:300", "codex:10080", "spark:300", "spark:10080"]);
  });

  it("accepts a multi-bucket response without the compatibility bucket", () => {
    expect(
      parseRateLimitsResult({
        rateLimitsByLimitId: {
          review: {
            limitName: "Code review",
            primary: { usedPercent: 20, windowDurationMins: 43_200 },
          },
        },
      }).windows
    ).toEqual([
      {
        id: "review:primary",
        limitId: "review",
        limitName: "Code review",
        usedPercent: 20,
        windowMinutes: 43_200,
      },
    ]);
  });

  it("sorts a bucket by duration instead of primary/secondary position", () => {
    expect(
      parseRateLimitsResult({
        rateLimits: {
          primary: { usedPercent: 43, windowDurationMins: 10_080 },
          secondary: { usedPercent: 17, windowDurationMins: 540 },
        },
      }).windows.map((window) => window.windowMinutes)
    ).toEqual([540, 10_080]);
  });

  it("keeps invalid numeric fields out of the renderer contract", () => {
    expect(
      parseRateLimitsResult({
        rateLimitResetCredits: { availableCount: -1 },
        rateLimits: {
          primary: { usedPercent: Number.NaN, windowDurationMins: 300 },
          secondary: { usedPercent: 17, windowDurationMins: -30 },
        },
      })
    ).toEqual({
      status: "ok",
      windows: [
        {
          id: "codex:secondary",
          limitId: "codex",
          usedPercent: 17,
        },
      ],
    });
  });
});
