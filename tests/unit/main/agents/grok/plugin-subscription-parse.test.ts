import { describe, expect, it } from "vitest";
import {
  parseGrokSubscriptionResult,
  parseGrokUserSubscriptionResult,
  resolveGrokMembership,
} from "../../../../../packages/plugin-grok/src/main/subscription-parse.ts";

describe("parseGrokSubscriptionResult", () => {
  it("maps active Grok Pro trial to planType, expiry, and trial end", () => {
    const result = parseGrokSubscriptionResult({
      subscriptions: [
        {
          tier: "SUBSCRIPTION_TIER_GROK_PRO",
          status: "SUBSCRIPTION_STATUS_ACTIVE",
          billingInterval: "BILLING_INTERVAL_MONTHLY",
          billingPeriodEnd: "2026-07-21T05:50:54.252Z",
          cancelAtPeriodEnd: false,
          google: {
            productId: "grok.pro",
            basePlanId: "p1m",
            expiryTime: "2026-07-21T05:50:54.252Z",
            autoRenewEnabled: true,
          },
          activeOffer: {
            type: "ACTIVE_OFFER_FREE_TRIAL",
            offerEnd: "2026-07-21T05:50:57.308566Z",
            freeTrial: { trialDays: 7 },
          },
        },
      ],
    });

    expect(result).toEqual({
      planType: "pro",
      status: "active",
      expiresAt: Date.parse("2026-07-21T05:50:54.252Z"),
      cancelAtPeriodEnd: false,
      trialEndsAt: Date.parse("2026-07-21T05:50:57.308566Z"),
    });
  });

  it("treats empty subscriptions as free", () => {
    expect(parseGrokSubscriptionResult({ subscriptions: [] })).toEqual({
      planType: "free",
      status: "none",
    });
  });

  it("prefers active paid subscription over expired entries", () => {
    const result = parseGrokSubscriptionResult({
      subscriptions: [
        {
          tier: "SUBSCRIPTION_TIER_GROK_PRO",
          status: "SUBSCRIPTION_STATUS_EXPIRED",
          billingPeriodEnd: "2026-01-01T00:00:00.000Z",
        },
        {
          tier: "SUBSCRIPTION_TIER_SUPERGROK",
          status: "SUBSCRIPTION_STATUS_ACTIVE",
          billingPeriodEnd: "2026-08-01T00:00:00.000Z",
          cancelAtPeriodEnd: true,
        },
      ],
    });

    expect(result).toMatchObject({
      planType: "supergrok",
      status: "active",
      expiresAt: Date.parse("2026-08-01T00:00:00.000Z"),
      cancelAtPeriodEnd: true,
    });
  });

  it("returns null for invalid payloads", () => {
    expect(parseGrokSubscriptionResult(null)).toBeNull();
    expect(parseGrokSubscriptionResult({})).toBeNull();
    expect(parseGrokSubscriptionResult({ subscriptions: "nope" })).toBeNull();
  });

  it("maps inactive vendor status to expired", () => {
    expect(
      parseGrokSubscriptionResult({
        subscriptions: [
          {
            tier: "SUBSCRIPTION_TIER_SUPER_GROK_PRO",
            status: "SUBSCRIPTION_STATUS_INACTIVE",
            billingPeriodEnd: "2026-09-15T00:00:00.000Z",
          },
        ],
      })
    ).toMatchObject({
      planType: "super_grok_pro",
      status: "expired",
      expiresAt: Date.parse("2026-09-15T00:00:00.000Z"),
    });
  });

  it("does not treat past_due as expired without an entitlement end", () => {
    expect(
      parseGrokSubscriptionResult({
        subscriptions: [
          {
            tier: "SUBSCRIPTION_TIER_SUPER_GROK_PRO",
            status: "SUBSCRIPTION_STATUS_PAST_DUE",
            billingPeriodEnd: "2026-09-15T00:00:00.000Z",
          },
        ],
      })
    ).toMatchObject({
      planType: "super_grok_pro",
      status: "unknown",
      expiresAt: Date.parse("2026-09-15T00:00:00.000Z"),
    });
  });

  it("uses Play entitlement end when auto-renew is already off", () => {
    expect(
      parseGrokSubscriptionResult({
        subscriptions: [
          {
            tier: "SUBSCRIPTION_TIER_SUPER_GROK_PRO",
            status: "SUBSCRIPTION_STATUS_ACTIVE",
            billingPeriodEnd: "2026-09-15T00:00:00.000Z",
            google: {
              autoRenewEnabled: false,
              expiryTime: "2026-09-05T00:00:00.000Z",
            },
          },
        ],
      })
    ).toMatchObject({
      planType: "super_grok_pro",
      status: "active",
      expiresAt: Date.parse("2026-09-05T00:00:00.000Z"),
    });
  });
});

describe("resolveGrokMembership", () => {
  const now = Date.parse("2026-09-10T00:00:00.000Z");

  it("lets live free clear a listed paid SuperGrok SKU", () => {
    expect(
      resolveGrokMembership(
        {
          planType: "super_grok_pro",
          status: "active",
          expiresAt: Date.parse("2026-09-15T00:00:00.000Z"),
        },
        { planType: "free", status: "none" },
        now
      )
    ).toEqual({ planType: "free", status: "none" });
  });

  it("clock-expires a listed paid SKU whose period already ended", () => {
    expect(
      resolveGrokMembership(
        {
          planType: "super_grok_pro",
          status: "active",
          expiresAt: Date.parse("2026-09-05T00:00:00.000Z"),
        },
        null,
        now
      )
    ).toMatchObject({
      planType: "super_grok_pro",
      status: "expired",
      expiresAt: Date.parse("2026-09-05T00:00:00.000Z"),
    });
  });

  it("does not revive a clock-expired listing from a leftover live tier string", () => {
    expect(
      resolveGrokMembership(
        {
          planType: "super_grok_pro",
          status: "expired",
          expiresAt: Date.parse("2026-09-05T00:00:00.000Z"),
        },
        { planType: "super_grok_pro", status: "active" },
        now
      )
    ).toMatchObject({
      planType: "super_grok_pro",
      status: "expired",
    });
  });

  it("lets live expired beat a listed ACTIVE SKU with a future period end", () => {
    expect(
      resolveGrokMembership(
        {
          planType: "super_grok_pro",
          status: "active",
          expiresAt: Date.parse("2026-09-15T00:00:00.000Z"),
        },
        {
          planType: "super_grok_pro",
          status: "expired",
          expiresAt: Date.parse("2026-09-05T00:00:00.000Z"),
        },
        now
      )
    ).toMatchObject({
      planType: "super_grok_pro",
      status: "expired",
      expiresAt: Date.parse("2026-09-05T00:00:00.000Z"),
    });
  });

  it("keeps a renewed live period instead of expired listing dates", () => {
    expect(
      resolveGrokMembership(
        {
          planType: "super_grok_pro",
          status: "expired",
          expiresAt: Date.parse("2026-09-05T00:00:00.000Z"),
        },
        {
          planType: "super_grok_pro",
          status: "active",
          expiresAt: Date.parse("2026-10-10T00:00:00.000Z"),
        },
        now
      )
    ).toMatchObject({
      planType: "super_grok_pro",
      status: "active",
      expiresAt: Date.parse("2026-10-10T00:00:00.000Z"),
    });
  });

  it("keeps a still-live listed membership when the live probe is unavailable", () => {
    expect(
      resolveGrokMembership(
        {
          planType: "pro",
          status: "active",
          expiresAt: Date.parse("2026-10-01T00:00:00.000Z"),
        },
        null,
        now
      )
    ).toMatchObject({
      planType: "pro",
      status: "active",
    });
  });
});

describe("parseGrokUserSubscriptionResult", () => {
  it("uses the user subscription tier as a paid fallback", () => {
    expect(
      parseGrokUserSubscriptionResult({ subscriptionTier: "GrokPro" })
    ).toEqual({ planType: "pro", status: "active" });
  });

  it("treats an explicit free tier as authoritative free membership", () => {
    expect(
      parseGrokUserSubscriptionResult({
        user: { subscriptionTier: "SUBSCRIPTION_TIER_FREE" },
      })
    ).toEqual({ planType: "free", status: "none" });
  });

  it("keeps explicit free even when nested still names a paid SuperGrok row", () => {
    expect(
      parseGrokUserSubscriptionResult({
        subscriptionTier: "SUBSCRIPTION_TIER_FREE",
        subscription: {
          billingPeriodEnd: "2026-09-15T00:00:00.000Z",
          status: "SUBSCRIPTION_STATUS_ACTIVE",
          tier: "SUBSCRIPTION_TIER_SUPER_GROK_PRO",
        },
      })
    ).toEqual({ planType: "free", status: "none" });
  });

  it.each([
    { subscriptionTier: null },
    { subscriptionTier: "" },
    { subscription_tier: null },
    { user: { subscriptionTier: null } },
  ])("recognizes an explicitly empty live subscription: %j", (payload) => {
    expect(parseGrokUserSubscriptionResult(payload)).toEqual({
      planType: "free",
      status: "none",
    });
  });

  it.each([
    {},
    { user: {} },
    { subscriptionTier: 42 },
  ])("leaves unavailable or malformed membership unresolved: %j", (payload) => {
    expect(parseGrokUserSubscriptionResult(payload)).toBeNull();
  });

  it("reads nested include=subscription status instead of a leftover tier string", () => {
    expect(
      parseGrokUserSubscriptionResult({
        subscriptionTier: "SuperGrokPro",
        subscription: {
          tier: "SUBSCRIPTION_TIER_SUPER_GROK_PRO",
          status: "SUBSCRIPTION_STATUS_EXPIRED",
          billingPeriodEnd: "2026-09-05T00:00:00.000Z",
        },
      })
    ).toMatchObject({
      planType: "super_grok_pro",
      status: "expired",
      expiresAt: Date.parse("2026-09-05T00:00:00.000Z"),
    });
  });
});
