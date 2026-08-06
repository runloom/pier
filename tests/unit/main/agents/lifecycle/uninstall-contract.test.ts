import { describe, expect, it } from "vitest";
import {
  agentLifecycleActionSchema,
  agentLifecycleErrorCodeSchema,
  agentLifecycleProbeSchema,
} from "../../../../../src/shared/contracts/agent/lifecycle.ts";

describe("lifecycle uninstall contract", () => {
  it("parses uninstall action", () => {
    expect(agentLifecycleActionSchema.parse("uninstall")).toBe("uninstall");
  });

  it("parses still_detected error", () => {
    expect(agentLifecycleErrorCodeSchema.parse("still_detected")).toBe(
      "still_detected"
    );
  });

  it("requires canUninstall and uninstallMode on probe", () => {
    const probe = agentLifecycleProbeSchema.parse({
      agentId: "claude",
      canInstall: true,
      canUninstall: false,
      detected: true,
      installedButBroken: false,
      installs: [],
      isConflict: false,
      latestVersion: null,
      support: "full",
      updateAvailable: false,
      updateMode: "versioned",
      updateOffered: true,
      uninstallMode: "none",
      version: "1.0.0",
    });
    expect(probe.canUninstall).toBe(false);
    expect(probe.uninstallMode).toBe("none");
  });
});
