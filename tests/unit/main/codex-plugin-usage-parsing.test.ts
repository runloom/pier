import { describe, expect, it } from "vitest";
import { parseRateLimitsResult } from "../../../packages/plugin-codex/src/main/codex-usage.ts";

describe("Codex App Server usage parsing", () => {
  it("maps remaining windows and reset credits", () => {
    expect(
      parseRateLimitsResult({
        rateLimitResetCredits: { availableCount: 3 },
        rateLimits: {
          primary: { resetsAt: 100, usedPercent: 38, windowDurationMins: 300 },
          secondary: { usedPercent: 64, windowDurationMins: 10_080 },
        },
      })
    ).toMatchObject({
      resetCreditsAvailable: 3,
      session: { resetsAt: 100_000, usedPercent: 38, windowMinutes: 300 },
      status: "ok",
      weekly: { usedPercent: 64, windowMinutes: 10_080 },
    });
  });

  it("normalizes a lone weekly primary window for weekly-only accounts", () => {
    expect(
      parseRateLimitsResult({
        rateLimits: {
          primary: { usedPercent: 5, windowDurationMins: 10_080 },
          secondary: null,
        },
      })
    ).toEqual({
      status: "ok",
      weekly: { usedPercent: 5, windowMinutes: 10_080 },
    });
  });

  it("keeps a lone session primary window as the session quota", () => {
    expect(
      parseRateLimitsResult({
        rateLimits: {
          primary: { usedPercent: 5, windowDurationMins: 300 },
          secondary: null,
        },
      })
    ).toEqual({
      session: { usedPercent: 5, windowMinutes: 300 },
      status: "ok",
    });
  });

  it("normalizes reversed weekly and unknown windows", () => {
    expect(
      parseRateLimitsResult({
        rateLimits: {
          primary: { usedPercent: 43, windowDurationMins: 10_080 },
          secondary: { usedPercent: 17, windowDurationMins: 540 },
        },
      })
    ).toEqual({
      session: { usedPercent: 17, windowMinutes: 540 },
      status: "ok",
      weekly: { usedPercent: 43, windowMinutes: 10_080 },
    });
  });
});
