import { describe, expect, it } from "vitest";
import { accountMembershipSummary } from "../../../packages/plugin-grok/src/renderer/account-display.tsx";

const t = (_key: string, fallback: string) => fallback;
const now = Date.parse("2026-07-17T00:00:00.000Z");

describe("accountMembershipSummary", () => {
  it("falls back to auth kind when membership is unknown", () => {
    expect(accountMembershipSummary({ kind: "oidc" }, "en", t, now)).toBe(
      "OIDC"
    );
    expect(accountMembershipSummary({ kind: "api_key" }, "en", t, now)).toBe(
      "API key"
    );
  });

  it("prefers trial end over generic expiry", () => {
    const text = accountMembershipSummary(
      {
        kind: "oidc",
        subscription: {
          planType: "pro",
          status: "active",
          expiresAt: Date.parse("2026-07-21T05:50:54.252Z"),
          trialEndsAt: Date.parse("2026-07-21T05:50:57.308566Z"),
          cancelAtPeriodEnd: false,
        },
      },
      "en",
      t,
      now
    );
    expect(text).toContain("PRO");
    expect(text).toContain("Trial ends");
    expect(text).toContain("OIDC");
    expect(text).not.toContain("Expires");
  });

  it("shows cancel-at-period-end for paid membership", () => {
    const text = accountMembershipSummary(
      {
        kind: "oidc",
        subscription: {
          planType: "supergrok",
          status: "active",
          expiresAt: Date.parse("2026-08-01T00:00:00.000Z"),
          cancelAtPeriodEnd: true,
        },
      },
      "en",
      t,
      now
    );
    expect(text).toContain("SUPERGROK");
    expect(text).toContain("Expires");
    expect(text).toContain("Cancels at period end");
  });
});
