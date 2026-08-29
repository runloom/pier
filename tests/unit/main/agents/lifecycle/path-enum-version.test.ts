import { describe, expect, it } from "vitest";
import {
  shouldProbeInstallVersion,
  shouldSkipEnumeratedBin,
} from "../../../../../src/main/services/agents/lifecycle/sources/path-enum.ts";

describe("shouldProbeInstallVersion", () => {
  it("only versions the PATH-default copy", () => {
    expect(shouldProbeInstallVersion(0)).toBe(true);
    expect(shouldProbeInstallVersion(1)).toBe(false);
    expect(shouldProbeInstallVersion(2)).toBe(false);
  });
});

describe("shouldSkipEnumeratedBin", () => {
  it("skips Grok agent and leftover Python kimi-cli", () => {
    expect(
      shouldSkipEnumeratedBin(
        "agent",
        "/Users/x/.grok/bin/agent",
        "/Users/x/.grok/bin/agent"
      )
    ).toBe(true);
    expect(
      shouldSkipEnumeratedBin(
        "agent",
        "/Users/x/.local/bin/agent",
        "/Users/x/.local/share/cursor-agent/agent"
      )
    ).toBe(false);
    expect(
      shouldSkipEnumeratedBin(
        "kimi-cli",
        "/Users/x/.local/bin/kimi-cli",
        "/Users/x/.local/share/uv/tools/kimi-cli/bin/kimi-cli"
      )
    ).toBe(true);
    expect(
      shouldSkipEnumeratedBin(
        "kimi",
        "/Users/x/.local/bin/kimi",
        "/Users/x/.local/share/uv/tools/kimi-cli/bin/kimi"
      )
    ).toBe(true);
    expect(
      shouldSkipEnumeratedBin(
        "kimi",
        "/Users/x/.kimi-code/bin/kimi",
        "/Users/x/.kimi-code/bin/kimi"
      )
    ).toBe(false);
  });
});
