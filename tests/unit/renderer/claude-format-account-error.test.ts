import { describe, expect, it } from "vitest";
import { formatAccountError } from "../../../packages/plugin-claude/src/renderer/format-account-error.ts";

const t = (_key: string, fallback: string) => fallback;

describe("Claude formatAccountError", () => {
  it("maps missing local Claude login errors", () => {
    expect(
      formatAccountError(new Error("No valid Claude login found"), t)
    ).toBe(
      "No valid local Claude login found. Sign in with the Claude CLI first."
    );
    expect(formatAccountError(new Error("No valid login found"), t)).toBe(
      "No valid local Claude login found. Sign in with the Claude CLI first."
    );
  });

  it("maps capture, credential, and not-ready failures", () => {
    expect(
      formatAccountError(
        new Error("Could not capture the current Claude credential"),
        t
      )
    ).toBe(
      "Couldn't capture the current Claude login. Try signing in again with the Claude CLI."
    );
    expect(
      formatAccountError(new Error("No stored Claude credential"), t)
    ).toBe(
      "This account's stored credential is missing — remove it and import again."
    );
    expect(
      formatAccountError(
        new Error("No RPC handler registered for accounts.add"),
        t
      )
    ).toBe("Claude plugin is still starting — try again in a moment");
  });
});
