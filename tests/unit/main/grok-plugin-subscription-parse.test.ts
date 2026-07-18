import { describe, expect, it } from "vitest";
import { parseGrokSubscriptionResult } from "../../../packages/plugin-grok/src/main/subscription-parse.ts";

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
});
