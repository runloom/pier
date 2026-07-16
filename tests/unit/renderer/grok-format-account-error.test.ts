import { describe, expect, it } from "vitest";
import { formatAccountError } from "../../../packages/plugin-grok/src/renderer/format-account-error.ts";

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
});
