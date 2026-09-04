import { describe, expect, it } from "vitest";
import {
  applyLiveMembership,
  applyLivePlanType,
  buildAccountRecord,
  mergeIdentityIntoAccount,
} from "../../../../../packages/plugin-codex/src/main/accounts-records.ts";
import type { CodexAccountRecord } from "../../../../../packages/plugin-codex/src/main/state.ts";

const baseAccount: CodexAccountRecord = {
  createdAt: 1,
  email: "legacy@example.com",
  id: "account-1",
  planType: "pro",
  provider: "codex",
  providerAccountId: "provider-1",
  subscriptionExpiresAt: Date.parse("2026-08-10T14:03:28+00:00"),
  updatedAt: 1,
};

describe("mergeIdentityIntoAccount", () => {
  it("overwrites plan and clears paid expiry when identity downgrades to free", () => {
    const merged = mergeIdentityIntoAccount(
      baseAccount,
      {
        email: "legacy@example.com",
        planType: "free",
        providerAccountId: "provider-1",
      },
      100
    );

    expect(merged).toMatchObject({
      email: "legacy@example.com",
      planType: "free",
      providerAccountId: "provider-1",
      updatedAt: 100,
    });
    expect(merged.subscriptionExpiresAt).toBeUndefined();
  });

  it("keeps previous plan when identity omits plan claims", () => {
    const merged = mergeIdentityIntoAccount(
      baseAccount,
      {
        email: "legacy@example.com",
        providerAccountId: "provider-1",
      },
      100
    );

    expect(merged.planType).toBe("pro");
    expect(merged.subscriptionExpiresAt).toBe(
      baseAccount.subscriptionExpiresAt
    );
    expect(merged.providerAccountId).toBe("provider-1");
  });

  it("does not let a JWT pro label replace a live precise SKU", () => {
    const merged = mergeIdentityIntoAccount(
      {
        ...baseAccount,
        hasActiveSubscription: true,
        planType: "pro-20x",
      },
      {
        email: "legacy@example.com",
        planType: "pro",
        providerAccountId: "provider-1",
      },
      100
    );

    expect(merged.planType).toBe("pro-20x");
    expect(merged.hasActiveSubscription).toBe(true);
  });

  it("does not let a stale JWT period-end replace a live renewal date", () => {
    const renewsAt = Date.parse("2026-10-04T21:38:26+00:00");
    const staleJwt = Date.parse("2026-08-10T14:03:28+00:00");
    const merged = mergeIdentityIntoAccount(
      {
        ...baseAccount,
        hasActiveSubscription: true,
        subscriptionExpiresAt: renewsAt,
      },
      {
        email: "legacy@example.com",
        planType: "pro",
        providerAccountId: "provider-1",
        subscriptionExpiresAt: staleJwt,
      },
      100
    );

    expect(merged.hasActiveSubscription).toBe(true);
    expect(merged.subscriptionExpiresAt).toBe(renewsAt);
  });

  it("keeps a live inactive period-end instead of a JWT claim", () => {
    const merged = mergeIdentityIntoAccount(
      {
        ...baseAccount,
        hasActiveSubscription: false,
      },
      {
        email: "legacy@example.com",
        planType: "pro",
        providerAccountId: "provider-1",
        subscriptionExpiresAt: Date.parse("2026-09-01T00:00:00.000Z"),
      },
      100
    );

    expect(merged.hasActiveSubscription).toBe(false);
    expect(merged.subscriptionExpiresAt).toBe(
      baseAccount.subscriptionExpiresAt
    );
  });
});

describe("buildAccountRecord", () => {
  it("omits paid subscription fields for free identity", () => {
    expect(
      buildAccountRecord(
        {
          email: "free@example.com",
          planType: "free",
          providerAccountId: "provider-free",
        },
        "account-free",
        50
      )
    ).toEqual({
      createdAt: 50,
      email: "free@example.com",
      id: "account-free",
      planType: "free",
      provider: "codex",
      providerAccountId: "provider-free",
      updatedAt: 50,
    });
  });
});

describe("applyLivePlanType", () => {
  it("overrides stale pro with free and clears paid expiry", () => {
    const next = applyLivePlanType(baseAccount, "free", 200);
    expect(next.planType).toBe("free");
    expect(next.subscriptionExpiresAt).toBeUndefined();
    expect(next.updatedAt).toBe(200);
  });

  it("returns the same reference when plan is unchanged", () => {
    const paid = applyLivePlanType(baseAccount, "pro", 200);
    expect(paid).toBe(baseAccount);
  });

  it("does not downgrade a precise entitlement from a broad wham pro label", () => {
    const precise = { ...baseAccount, planType: "pro-20x" };
    expect(applyLivePlanType(precise, "pro", 200)).toBe(precise);
  });

  it("clears previous expiry when live paid plan changes", () => {
    const next = applyLivePlanType(baseAccount, "plus", 200);
    expect(next.planType).toBe("plus");
    expect(next.subscriptionExpiresAt).toBeUndefined();
    expect(next.updatedAt).toBe(200);
  });

  it("drops a stale past period-end when live usage still reports a paid plan", () => {
    const now = baseAccount.subscriptionExpiresAt! + 86_400_000;
    const next = applyLivePlanType(baseAccount, "pro", now);
    expect(next.planType).toBe("pro");
    expect(next.subscriptionExpiresAt).toBeUndefined();
    expect(next.hasActiveSubscription).toBeUndefined();
    expect(next.updatedAt).toBe(now);
  });

  it("keeps a live inactive flag when membership is unresolved", () => {
    const now = baseAccount.subscriptionExpiresAt! + 86_400_000;
    const next = applyLivePlanType(
      { ...baseAccount, hasActiveSubscription: false },
      "pro",
      now
    );
    expect(next.hasActiveSubscription).toBe(false);
    expect(next.subscriptionExpiresAt).toBe(baseAccount.subscriptionExpiresAt);
  });

  it("keeps a live inactive flag on a precise SKU when usage only reports pro", () => {
    const now = baseAccount.subscriptionExpiresAt! + 86_400_000;
    const next = applyLivePlanType(
      {
        ...baseAccount,
        hasActiveSubscription: false,
        planType: "pro-20x",
      },
      "pro",
      now
    );
    expect(next.planType).toBe("pro-20x");
    expect(next.hasActiveSubscription).toBe(false);
    expect(next.subscriptionExpiresAt).toBe(baseAccount.subscriptionExpiresAt);
  });
});

describe("applyLiveMembership", () => {
  it("replaces a stale past period-end with the live renewal date", () => {
    const now = Date.parse("2026-09-04T08:00:00.000Z");
    const renewsAt = Date.parse("2026-10-04T21:38:26+00:00");
    const next = applyLiveMembership(
      baseAccount,
      {
        expiresAt: renewsAt,
        hasActiveSubscription: true,
        planType: "pro-20x",
      },
      now
    );
    expect(next).toMatchObject({
      hasActiveSubscription: true,
      planType: "pro-20x",
      subscriptionExpiresAt: renewsAt,
      updatedAt: now,
    });
  });

  it("drops a past period-end when the live entitlement is still active", () => {
    const now = Date.parse("2026-09-04T08:00:00.000Z");
    const next = applyLiveMembership(
      baseAccount,
      {
        expiresAt: baseAccount.subscriptionExpiresAt,
        hasActiveSubscription: true,
        planType: "pro",
      },
      now
    );
    expect(next.hasActiveSubscription).toBe(true);
    expect(next.subscriptionExpiresAt).toBeUndefined();
  });

  it("keeps a past period-end when the live entitlement is inactive", () => {
    const now = Date.parse("2026-09-04T08:00:00.000Z");
    const next = applyLiveMembership(
      baseAccount,
      {
        expiresAt: baseAccount.subscriptionExpiresAt,
        hasActiveSubscription: false,
        planType: "pro",
      },
      now
    );
    expect(next).toMatchObject({
      hasActiveSubscription: false,
      planType: "pro",
      subscriptionExpiresAt: baseAccount.subscriptionExpiresAt,
    });
  });
});
