import { describe, expect, it } from "vitest";
import {
  accountPlanSummary,
  codexAccountMembership,
} from "../../../../packages/plugin-codex/src/renderer/account-display.tsx";

const t = (_key: string, fallback: string) => fallback;
const now = Date.parse("2026-07-17T00:00:00.000Z");
const pastExpiry = Date.parse("2026-08-10T14:03:28+00:00");
const afterRenewal = Date.parse("2026-09-04T08:00:00.000Z");

describe("accountPlanSummary", () => {
  it("returns null when plan and expiry are both missing", () => {
    expect(accountPlanSummary({}, "en", t, now)).toBeNull();
  });

  it("shows plan only when expiry is missing", () => {
    expect(accountPlanSummary({ planType: "pro" }, "en", t, now)).toBe("PRO");
  });

  it("shows FREE without expiry when the account is free", () => {
    expect(
      accountPlanSummary(
        {
          planType: "free",
          subscriptionExpiresAt: Date.parse("2026-08-10T14:03:28+00:00"),
        },
        "en",
        t,
        now
      )
    ).toBe("FREE");
  });

  it("hides leftover expiry for free-like plan labels", () => {
    expect(
      accountPlanSummary(
        {
          planType: "none",
          subscriptionExpiresAt: Date.parse("2026-08-10T14:03:28+00:00"),
        },
        "en",
        t,
        now
      )
    ).toBe("NONE");
  });

  it("appends relative expiry when subscriptionExpiresAt is present", () => {
    const text = accountPlanSummary(
      {
        planType: "pro",
        subscriptionExpiresAt: Date.parse("2026-08-10T14:03:28+00:00"),
      },
      "en",
      t,
      now
    );
    expect(text).toContain("PRO");
    expect(text).toContain("Expires");
  });

  it("does not treat a stale past period-end as expired after renewal", () => {
    expect(
      accountPlanSummary(
        {
          planType: "pro",
          subscriptionExpiresAt: pastExpiry,
        },
        "en",
        t,
        afterRenewal
      )
    ).toBe("PRO");
  });

  it("labels a live-inactive paid plan as expired", () => {
    const text = accountPlanSummary(
      {
        hasActiveSubscription: false,
        planType: "pro",
        subscriptionExpiresAt: pastExpiry,
      },
      "en",
      t,
      afterRenewal
    );
    expect(text).toContain("PRO");
    expect(text).toContain("Expired");
  });
});

describe("codexAccountMembership", () => {
  it("keeps a paid plan active when only a stale period-end timestamp is past", () => {
    expect(
      codexAccountMembership(
        {
          planType: "pro",
          subscriptionExpiresAt: pastExpiry,
        },
        afterRenewal,
        afterRenewal
      )
    ).toMatchObject({
      status: "active",
      tier: "pro",
    });
  });

  it("omits a stale past period-end so the expired chip is not shown", () => {
    const membership = codexAccountMembership(
      {
        planType: "pro",
        subscriptionExpiresAt: pastExpiry,
      },
      afterRenewal,
      afterRenewal
    );
    expect(membership?.expiresAt).toBeUndefined();
  });

  it("marks membership expired only from live inactive entitlement", () => {
    expect(
      codexAccountMembership(
        {
          hasActiveSubscription: false,
          planType: "pro",
          subscriptionExpiresAt: pastExpiry,
        },
        afterRenewal,
        afterRenewal
      )
    ).toMatchObject({
      expiresAt: pastExpiry,
      status: "expired",
      tier: "pro",
    });
  });

  it("keeps an active entitlement even when the stored period-end is past", () => {
    expect(
      codexAccountMembership(
        {
          hasActiveSubscription: true,
          planType: "pro",
          subscriptionExpiresAt: pastExpiry,
        },
        afterRenewal,
        afterRenewal
      )
    ).toMatchObject({
      status: "active",
      tier: "pro",
    });
  });
});
