import { isAgentUpdateOffered } from "@shared/agent-lifecycle/update-offer.ts";
import { describe, expect, it } from "vitest";

describe("isAgentUpdateOffered", () => {
  const base = {
    canInstall: true,
    detected: true,
    installedButBroken: false,
    support: "full" as const,
    updateAvailable: false,
  };

  it("is true only for a real versioned upgrade or a broken install", () => {
    expect(isAgentUpdateOffered({ ...base, updateAvailable: true })).toBe(true);
    expect(isAgentUpdateOffered({ ...base, installedButBroken: true })).toBe(
      true
    );
    expect(isAgentUpdateOffered(base)).toBe(false);
  });

  it("does not treat reinstall-only (no newer version) as a pending update", () => {
    expect(
      isAgentUpdateOffered({
        ...base,
        updateAvailable: false,
        installedButBroken: false,
      })
    ).toBe(false);
  });

  it("rejects missing, ungated, or not-full agents", () => {
    expect(
      isAgentUpdateOffered({
        ...base,
        detected: false,
        updateAvailable: true,
      })
    ).toBe(false);
    expect(
      isAgentUpdateOffered({
        ...base,
        canInstall: false,
        updateAvailable: true,
      })
    ).toBe(false);
    expect(
      isAgentUpdateOffered({
        ...base,
        support: "guided",
        updateAvailable: true,
      })
    ).toBe(false);
    expect(isAgentUpdateOffered(undefined)).toBe(false);
  });
});
