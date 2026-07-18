import { describe, expect, it } from "vitest";
import { parseIdTokenClaims } from "../../../packages/plugin-codex/src/main/identity.ts";

function encodeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" })
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

describe("parseIdTokenClaims", () => {
  it("extracts plan type and subscription active_until as expiresAt ms", () => {
    const token = encodeJwt({
      email: "pro@example.com",
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct-1",
        chatgpt_plan_type: "pro",
        chatgpt_subscription_active_start: "2026-07-10T14:03:28+00:00",
        chatgpt_subscription_active_until: "2026-08-10T14:03:28+00:00",
      },
    });

    expect(parseIdTokenClaims(token)).toEqual({
      email: "pro@example.com",
      planType: "pro",
      providerAccountId: "acct-1",
      subscriptionExpiresAt: Date.parse("2026-08-10T14:03:28+00:00"),
    });
  });

  it("omits subscriptionExpiresAt when until claim is missing or invalid", () => {
    const noUntil = encodeJwt({
      email: "free@example.com",
      "https://api.openai.com/auth": {
        chatgpt_plan_type: "free",
      },
    });
    expect(parseIdTokenClaims(noUntil)).toEqual({
      email: "free@example.com",
      planType: "free",
    });

    const badUntil = encodeJwt({
      email: "bad@example.com",
      "https://api.openai.com/auth": {
        chatgpt_plan_type: "plus",
        chatgpt_subscription_active_until: "not-a-date",
      },
    });
    expect(parseIdTokenClaims(badUntil)).toEqual({
      email: "bad@example.com",
      planType: "plus",
    });
  });
});
