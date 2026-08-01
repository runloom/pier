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
});
