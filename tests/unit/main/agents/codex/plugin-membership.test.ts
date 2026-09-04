import { describe, expect, it } from "vitest";
import {
  normalizeCodexMembershipTier,
  parseCodexAccountCheckMembership,
  parseCodexSubscriptionsMembership,
} from "../../../../../packages/plugin-codex/src/main/codex-membership.ts";

describe("Codex membership parsing", () => {
  it("maps entitlement SKUs without guessing from a bare pro value", () => {
    expect(normalizeCodexMembershipTier("chatgptprolite", "entitlement")).toBe(
      "pro-5x"
    );
    expect(normalizeCodexMembershipTier("chatgptpro", "entitlement")).toBe(
      "pro-20x"
    );
    expect(normalizeCodexMembershipTier("pro", "usage")).toBe("pro");
  });

  it("uses the matching account entitlement and its expiry", () => {
    expect(
      parseCodexAccountCheckMembership(
        {
          accounts: {
            other: {
              account: { plan_type: "plus" },
              entitlement: { subscription_plan: "chatgptplus" },
            },
            target: {
              account: { plan_type: "pro" },
              entitlement: {
                expires_at: "2026-08-28T21:38:26+00:00",
                subscription_plan: "chatgptpro",
              },
            },
          },
        },
        "target"
      )
    ).toEqual({
      expiresAt: Date.parse("2026-08-28T21:38:26+00:00"),
      planType: "pro-20x",
    });
  });

  it("falls back to the subscriptions response", () => {
    expect(
      parseCodexSubscriptionsMembership({
        active_until: "2026-08-28T15:38:26Z",
        plan_type: "chatgptprolite",
      })
    ).toEqual({
      expiresAt: Date.parse("2026-08-28T15:38:26Z"),
      planType: "pro-5x",
    });
  });

  it("prefers renews_at over a stale expires_at when the subscription is active", () => {
    expect(
      parseCodexAccountCheckMembership(
        {
          accounts: {
            target: {
              account: { plan_type: "pro" },
              entitlement: {
                expires_at: "2026-08-28T21:38:26+00:00",
                has_active_subscription: true,
                renews_at: "2026-10-04T21:38:26+00:00",
                subscription_plan: "chatgptpro",
              },
            },
          },
        },
        "target"
      )
    ).toEqual({
      expiresAt: Date.parse("2026-10-04T21:38:26+00:00"),
      hasActiveSubscription: true,
      planType: "pro-20x",
    });
  });

  it("keeps a past expires_at when the live entitlement is inactive", () => {
    expect(
      parseCodexAccountCheckMembership(
        {
          accounts: {
            target: {
              entitlement: {
                expires_at: "2026-08-28T21:38:26+00:00",
                has_active_subscription: false,
                subscription_plan: "chatgptpro",
              },
            },
          },
        },
        "target"
      )
    ).toEqual({
      expiresAt: Date.parse("2026-08-28T21:38:26+00:00"),
      hasActiveSubscription: false,
      planType: "pro-20x",
    });
  });

  it("matches the account by inner account_id when the map key differs", () => {
    expect(
      parseCodexAccountCheckMembership(
        {
          accounts: {
            default: {
              entitlement: { subscription_plan: "chatgptfreeplan" },
            },
            "workspace-1": {
              account: { account_id: "acct-file", plan_type: "pro" },
              entitlement: {
                has_active_subscription: true,
                renews_at: "2026-10-04T21:38:26+00:00",
                subscription_plan: "chatgptpro",
              },
            },
          },
        },
        "acct-file"
      )
    ).toEqual({
      expiresAt: Date.parse("2026-10-04T21:38:26+00:00"),
      hasActiveSubscription: true,
      planType: "pro-20x",
    });
  });
});
