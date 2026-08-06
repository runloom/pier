import { describe, expect, it } from "vitest";
import { parseBrewInfoVersion } from "../../../../../src/main/services/agents/lifecycle/latest.ts";
import { getAgentLifecycleSpec } from "../../../../../src/main/services/agents/lifecycle/specs/index.ts";
import { resolveUpdateMode } from "../../../../../src/main/services/agents/lifecycle/specs/types.ts";

describe("parseBrewInfoVersion", () => {
  it("reads formula stable version", () => {
    expect(
      parseBrewInfoVersion(
        JSON.stringify({
          formulae: [{ versions: { stable: "1.18.14" } }],
          casks: [],
        })
      )
    ).toBe("1.18.14");
  });

  it("reads cask version when formulae empty (claude-code / copilot-cli)", () => {
    expect(
      parseBrewInfoVersion(
        JSON.stringify({
          formulae: [],
          casks: [{ version: "2.1.222" }],
        })
      )
    ).toBe("2.1.222");
  });

  it("prefers formula over cask when both present", () => {
    expect(
      parseBrewInfoVersion(
        JSON.stringify({
          formulae: [{ versions: { stable: "1.0.0" } }],
          casks: [{ version: "9.9.9" }],
        })
      )
    ).toBe("1.0.0");
  });

  it("returns null for empty brew json", () => {
    expect(
      parseBrewInfoVersion(JSON.stringify({ formulae: [], casks: [] }))
    ).toBeNull();
  });
});

describe("agent latest probe channels", () => {
  it("claude is versioned with brew cask + npm package for latest", () => {
    const spec = getAgentLifecycleSpec("claude");
    expect(resolveUpdateMode(spec)).toBe("versioned");
    const brew = spec.install.find((c) => c.kind === "brew");
    expect(brew?.kind === "brew" && brew.cask).toBe(true);
    expect(spec.npmPackageForLatest).toBe("@anthropic-ai/claude-code");
  });

  it("kimi is versioned with uv + npm (uv-upgrade preferred for uv source)", () => {
    const spec = getAgentLifecycleSpec("kimi");
    expect(resolveUpdateMode(spec)).toBe("versioned");
    expect(
      spec.install.some((c) => c.kind === "uv" && c.package === "kimi-cli")
    ).toBe(true);
    expect(spec.update.some((c) => c.kind === "uv-upgrade")).toBe(true);
    // Different product lines — must not compare uv installs to this npm name.
    expect(spec.npmPackageForLatest).toBe("@moonshot-ai/kimi-code");
    expect(spec.npmPackageForLatest).not.toBe("kimi-cli");
  });
});
