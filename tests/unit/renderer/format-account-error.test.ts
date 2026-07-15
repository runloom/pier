import { describe, expect, it } from "vitest";
import { formatAccountError } from "../../../packages/plugin-codex/src/renderer/format-account-error.ts";

const t = (_key: string, fallback: string) => fallback;

describe("formatAccountError", () => {
  it("maps omp sqlite bind failures to install guidance", () => {
    expect(
      formatAccountError(new Error("omp: Unknown named parameter '0'"), t)
    ).toBe(
      "Couldn't sync credentials to OMP. Make sure OMP is installed and has been opened at least once on this device."
    );
  });

  it("maps missing local Codex login errors", () => {
    expect(
      formatAccountError(
        new Error("No valid codex login found at ~/.codex/auth.json"),
        t
      )
    ).toBe(
      "No valid local Codex login found. Sign in with the Codex CLI first."
    );
  });

  it("maps missing active account errors", () => {
    expect(
      formatAccountError(
        new Error(
          "No active managed account to sync. Select a managed Codex account first."
        ),
        t
      )
    ).toBe("Select a managed Codex account first, then try syncing again.");
  });

  it("maps multi-target peer-sync failures by first known peer prefix", () => {
    expect(
      formatAccountError(
        new Error("opencode: file missing; pi: file missing"),
        t
      )
    ).toBe(
      "Couldn't sync credentials to OpenCode. Make sure OpenCode is installed on this device."
    );
  });

  it("does not rewrite unrelated errors that merely mention sync", () => {
    expect(
      formatAccountError(new Error("git sync failed: network down"), t)
    ).toBe("git sync failed: network down");
  });

  it("keeps unrelated technical messages for unexpected failures", () => {
    expect(formatAccountError(new Error("disk full"), t)).toBe("disk full");
  });
});
