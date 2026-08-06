import { describe, expect, it } from "vitest";
import { resolveUninstallProbeFields } from "../../../../../src/main/services/agents/lifecycle/plan/uninstall.ts";
import { probeOneAgent } from "../../../../../src/main/services/agents/lifecycle/probe.ts";
import { getAgentLifecycleSpec } from "../../../../../src/main/services/agents/lifecycle/specs/index.ts";

describe("uninstall probe fields", () => {
  it("env-null degraded path still has canUninstall boolean + mode", async () => {
    const probe = await probeOneAgent("claude", null, {
      deep: false,
      checkLatest: false,
      envDegraded: true,
      host: "posix",
    });
    expect(typeof probe.canUninstall).toBe("boolean");
    expect(
      probe.uninstallMode === "managed" || probe.uninstallMode === "none"
    ).toBe(true);
    expect(probe.uninstallTargetPath).toBeNull();
    expect(probe.uninstallTargetSource).toBeNull();
    expect(probe.canUninstall).toBe(false);
    expect(probe.uninstallMode).toBe("none");
  });

  it("path source → canUninstall false but targets set", () => {
    const f = resolveUninstallProbeFields(
      getAgentLifecycleSpec("claude"),
      "posix",
      {
        path: "/Users/x/.local/bin/claude",
        source: "path",
      }
    );
    expect(f.canUninstall).toBe(false);
    expect(f.uninstallMode).toBe("none");
    expect(f.defaultUninstallCommand).toBeNull();
    expect(f.uninstallTargetPath).toBe("/Users/x/.local/bin/claude");
    expect(f.uninstallTargetSource).toBe("path");
  });

  it("npm source → canUninstall true when plan exists", () => {
    const f = resolveUninstallProbeFields(
      getAgentLifecycleSpec("gemini"),
      "posix",
      {
        path: "/usr/local/bin/gemini",
        source: "npm",
      }
    );
    expect(f.canUninstall).toBe(true);
    expect(f.uninstallMode).toBe("managed");
    expect(f.defaultUninstallCommand).toContain("uninstall");
    expect(f.uninstallTargetPath).toBe("/usr/local/bin/gemini");
    expect(f.uninstallTargetSource).toBe("npm");
  });

  it("defaultCommandsFor includes defaultUninstallCommand", async () => {
    const { defaultCommandsFor } = await import(
      "../../../../../src/main/services/agents/lifecycle/defaults.ts"
    );
    const cmds = defaultCommandsFor("gemini", "npm", "/usr/local/bin/gemini");
    expect(cmds.defaultUninstallCommand).toContain("uninstall");
    expect(cmds.defaultUninstallCommand).toContain("-g");
  });

  it("guided agent → canUninstall false and null command", () => {
    const f = resolveUninstallProbeFields(
      getAgentLifecycleSpec("rovo"),
      "posix",
      {
        path: "/usr/local/bin/rovo",
        source: "npm",
      }
    );
    expect(f.canUninstall).toBe(false);
    expect(f.uninstallMode).toBe("none");
    expect(f.defaultUninstallCommand).toBeNull();
    // K19: targets still filled when defaultInstall present
    expect(f.uninstallTargetPath).toBe("/usr/local/bin/rovo");
    expect(f.uninstallTargetSource).toBe("npm");
  });
});
