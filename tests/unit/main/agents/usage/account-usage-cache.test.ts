import { describe, expect, it } from "vitest";
import * as membershipCache from "../../../../../packages/plugin-api/src/account-usage/membership-cache.ts";
import {
  type AccountUsageMetric,
  createUsageCacheEntry,
} from "../../../../../packages/plugin-api/src/account-usage/usage-cache.ts";

const quota: AccountUsageMetric = {
  groupId: "codex",
  id: "codex:300",
  kind: "quota",
  usedPercent: 25,
  windowMinutes: 300,
};

describe("shared account usage cache", () => {
  it("records the successful data time separately from the attempt time", () => {
    expect(
      createUsageCacheEntry({ metrics: [quota], status: "ok" }, undefined, 1000)
    ).toEqual({
      attemptedAt: 1000,
      metrics: [quota],
      status: "ok",
      updatedAt: 1000,
    });
  });

  it("retains the last successful metrics and timestamp after an error", () => {
    const cached = createUsageCacheEntry(
      { metrics: [quota], status: "ok" },
      undefined,
      1000
    );

    expect(
      createUsageCacheEntry(
        { error: "network unavailable", metrics: [], status: "error" },
        cached,
        2000
      )
    ).toEqual({
      attemptedAt: 2000,
      error: "network unavailable",
      metrics: [quota],
      status: "error",
      updatedAt: 1000,
    });
  });

  it("does not invent a successful timestamp for an initial error", () => {
    expect(
      createUsageCacheEntry(
        { error: "not signed in", metrics: [], status: "error" },
        undefined,
        3000
      )
    ).toEqual({
      attemptedAt: 3000,
      error: "not signed in",
      metrics: [],
      status: "error",
    });
  });
});

describe("shared account membership cache", () => {
  it("retains the last successful membership after a transient error", () => {
    const cached = membershipCache.createMembershipCacheEntry(
      {
        membership: {
          status: "active",
          tier: "pro-20x",
        },
        status: "ok",
      },
      undefined,
      1000
    );

    expect(
      membershipCache.createMembershipCacheEntry(
        { error: "temporarily unavailable", status: "error" },
        cached,
        2000
      )
    ).toEqual({
      attemptedAt: 2000,
      error: "temporarily unavailable",
      membership: {
        status: "active",
        tier: "pro-20x",
        updatedAt: 1000,
      },
      status: "error",
      updatedAt: 1000,
    });
  });

  it("lets an authoritative free result replace a cached paid membership", () => {
    const cached = membershipCache.createMembershipCacheEntry(
      {
        membership: {
          status: "active",
          tier: "pro-20x",
        },
        status: "ok",
      },
      undefined,
      1000
    );

    expect(
      membershipCache.createMembershipCacheEntry(
        {
          membership: {
            status: "free",
            tier: "free",
          },
          status: "ok",
        },
        cached,
        3000
      )
    ).toEqual({
      attemptedAt: 3000,
      membership: {
        status: "free",
        tier: "free",
        updatedAt: 3000,
      },
      status: "ok",
      updatedAt: 3000,
    });
  });
});
