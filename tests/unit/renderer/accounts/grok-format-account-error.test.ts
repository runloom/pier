import { describe, expect, it } from "vitest";
import { formatAccountError } from "../../../../packages/plugin-grok/src/renderer/format-account-error.ts";

const t = (_key: string, fallback: string) => fallback;

describe("Grok formatAccountError", () => {
  it("maps missing local Grok login errors", () => {
    expect(
      formatAccountError(new Error("No valid Grok login found at auth.json"), t)
    ).toBe("No valid local Grok login found. Sign in with the Grok CLI first.");
    expect(
      formatAccountError(new Error("No valid login found at auth.json"), t)
    ).toBe("No valid local Grok login found. Sign in with the Grok CLI first.");
  });

  it("maps fx install failures and the api-key fail-closed to distinct copy", () => {
    expect(formatAccountError(new Error("fx: write failed"), t)).toBe(
      "Couldn't sync credentials to fx. Make sure fx is installed on this device."
    );
    expect(
      formatAccountError(
        new Error("fx has no xAI API-key path; sync an OIDC account instead"),
        t
      )
    ).toBe(
      "fx can only receive login (OIDC) accounts. Switch to a login account to sync to fx."
    );
  });

  it("keeps a safe CLI reason and adds an actionable next step", () => {
    expect(
      formatAccountError(
        new Error(
          "Grok login failed (exit code 1): This account does not have Grok Build access"
        ),
        t
      )
    ).toBe(
      "Grok sign-in did not complete: This account does not have Grok Build access. Confirm this account can use Grok Build, then try again."
    );
  });
});
