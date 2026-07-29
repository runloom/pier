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
      status: "ok",
      metrics: [
        {
          groupId: "codex",
          id: "codex:primary",
          kind: "quota",
          resetsAt: 100_000,
          usedPercent: 38,
          windowMinutes: 300,
        },
        {
          groupId: "codex",
          id: "codex:secondary",
          kind: "quota",
          usedPercent: 64,
          windowMinutes: 10_080,
        },
        {
          format: "count",
          id: "codex:reset-credits",
          kind: "scalar",
          value: 3,
        },
      ],
    });
  });

  it("preserves live planType from the rateLimits payload", () => {
    expect(
      parseRateLimitsResult({
        rateLimits: {
          limitId: "codex",
          planType: "free",
          primary: { usedPercent: 12, windowDurationMins: 300 },
        },
      })
    ).toMatchObject({
      planType: "free",
      status: "ok",
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
      }).metrics
    ).toEqual([
      {
        groupId: "codex",
        id,
        kind: "quota",
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
      }).metrics
    ).toEqual([
      {
        groupId: "codex",
        id: "codex:primary",
        kind: "quota",
        name: "Codex",
        usedPercent: 17,
        windowMinutes: 540,
      },
      {
        groupId: "review",
        id: "review:primary",
        kind: "quota",
        name: "Code review",
        usedPercent: 43,
        windowMinutes: 43_200,
      },
    ]);
  });

  it("merges a compatibility secondary window missing from the multi-bucket view", () => {
    expect(
      parseRateLimitsResult({
        rateLimits: {
          limitId: "codex",
          primary: { usedPercent: 17, windowDurationMins: 300 },
          secondary: { usedPercent: 41, windowDurationMins: 10_080 },
        },
        rateLimitsByLimitId: {
          spark: {
            limitId: "spark",
            limitName: "GPT-5.3-Codex-Spark",
            primary: { usedPercent: 0, windowDurationMins: 300 },
          },
          codex: {
            limitId: "codex",
            primary: { usedPercent: 17, windowDurationMins: 300 },
          },
        },
      }).metrics.map((metric) =>
        metric.kind === "quota"
          ? `${metric.id}:${metric.windowMinutes}`
          : metric.id
      )
    ).toEqual([
      "codex:primary:300",
      "codex:secondary:10080",
      "spark:primary:300",
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
      }).metrics.map((metric) =>
        metric.kind === "quota"
          ? `${metric.groupId}:${metric.windowMinutes}`
          : metric.id
      )
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
      }).metrics
    ).toEqual([
      {
        groupId: "review",
        id: "review:primary",
        kind: "quota",
        name: "Code review",
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
      }).metrics.map((metric) =>
        metric.kind === "quota" ? metric.windowMinutes : undefined
      )
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
      metrics: [
        {
          groupId: "codex",
          id: "codex:secondary",
          kind: "quota",
          usedPercent: 17,
        },
      ],
    });
  });
});
