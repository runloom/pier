import { describe, expect, it } from "vitest";
import { accountMembershipSummary } from "../../../packages/plugin-claude/src/renderer/account-display.tsx";

const t = (_key: string, fallback: string) => fallback;

describe("Claude accountMembershipSummary", () => {
  it("falls back to Claude when subscription is unknown", () => {
    expect(accountMembershipSummary({}, "en", t)).toBe("Claude");
  });

  it("shows plan and organization", () => {
    const text = accountMembershipSummary(
      {
        subscription: {
          organizationName: "Acme",
          planType: "max",
        },
      },
      "en",
      t
    );
    expect(text).toBe("MAX · Acme");
  });
});
