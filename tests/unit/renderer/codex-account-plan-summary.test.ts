import { describe, expect, it } from "vitest";
import { accountPlanSummary } from "../../../packages/plugin-codex/src/renderer/account-display.tsx";

const t = (_key: string, fallback: string) => fallback;
const now = Date.parse("2026-07-17T00:00:00.000Z");

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
});
