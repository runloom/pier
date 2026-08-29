import { describe, expect, it } from "vitest";
import { mergeLifecycleChildEnv } from "../../../../../src/main/services/agents/lifecycle/runner/child-env.ts";

describe("mergeLifecycleChildEnv", () => {
  it("never pins HOMEBREW_NO_AUTO_UPDATE (stale index would no-op brew upgrade)", () => {
    const merged = mergeLifecycleChildEnv({});
    expect(merged.HOMEBREW_NO_AUTO_UPDATE).toBeUndefined();
  });

  it("throttles brew auto-update instead of disabling it", () => {
    expect(mergeLifecycleChildEnv({}).HOMEBREW_AUTO_UPDATE_SECS).toBe("300");
    expect(
      mergeLifecycleChildEnv({ HOMEBREW_AUTO_UPDATE_SECS: "60" })
        .HOMEBREW_AUTO_UPDATE_SECS
    ).toBe("60");
  });

  it("respects an explicit user HOMEBREW_NO_AUTO_UPDATE", () => {
    expect(
      mergeLifecycleChildEnv({ HOMEBREW_NO_AUTO_UPDATE: "1" })
        .HOMEBREW_NO_AUTO_UPDATE
    ).toBe("1");
  });

  it("keeps non-interactive defaults", () => {
    const merged = mergeLifecycleChildEnv({});
    expect(merged.NONINTERACTIVE).toBe("1");
    expect(merged.HOMEBREW_NO_ENV_HINTS).toBe("1");
    expect(merged.HOMEBREW_NO_INSTALL_CLEANUP).toBe("1");
  });
});
