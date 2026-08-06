import { platform } from "node:os";
import { describe, expect, it } from "vitest";
import { planLifecycle } from "../../../../../src/main/services/agents/lifecycle/plan/build.ts";
import { buildUninstallPlan } from "../../../../../src/main/services/agents/lifecycle/plan/uninstall.ts";
import { getAgentLifecycleSpec } from "../../../../../src/main/services/agents/lifecycle/specs/index.ts";

describe("uninstall plan matrix", () => {
  it("claude @ brew → brew uninstall --cask (darwin) / null (non-darwin)", () => {
    // Cask uninstall is darwin-only (parity with install/upgrade). Linux CI
    // must not assert a brew cask step — production returns null for casks.
    // Use a non-resolving bin path so local realpath does not rewrite the
    // formula token (e.g. Caskroom/claude-code@latest on a real install).
    const plan = buildUninstallPlan(getAgentLifecycleSpec("claude"), {
      host: "posix",
      installSource: "brew",
      defaultBinPath: "/opt/homebrew/bin/claude-fixture-uninstalled",
    });
    if (platform() === "darwin") {
      expect(plan?.steps[0]).toMatchObject({
        kind: "argv",
        file: "brew",
        args: ["uninstall", "--cask", "claude-code"],
      });
      expect(plan?.preview).toContain("uninstall");
      expect(plan?.preview).toContain("--cask");
      expect(plan?.preview).toContain("claude-code");
    } else {
      expect(plan).toBeNull();
    }
  });

  it("gemini @ brew → brew uninstall formula (linux-safe)", () => {
    // Non-cask brew formula works on all platforms; locks managed brew uninstall
    // for Ubuntu CI without depending on cask darwin gate.
    const plan = buildUninstallPlan(getAgentLifecycleSpec("gemini"), {
      host: "posix",
      installSource: "brew",
      defaultBinPath: "/opt/homebrew/bin/gemini-fixture-uninstalled",
    });
    expect(plan?.steps[0]).toMatchObject({
      kind: "argv",
      file: "brew",
      args: ["uninstall", "gemini-cli"],
    });
    expect(plan?.preview).toContain("uninstall");
    expect(plan?.preview).toContain("gemini-cli");
    expect(plan?.preview).not.toContain("--cask");
  });

  it("gemini @ npm → npm uninstall -g", () => {
    const plan = buildUninstallPlan(getAgentLifecycleSpec("gemini"), {
      host: "posix",
      installSource: "npm",
    });
    expect(plan?.steps[0]).toMatchObject({ kind: "argv", file: "npm" });
    expect(plan?.preview).toContain("uninstall");
    expect(plan?.preview).toContain("-g");
    expect(plan?.preview).toContain("@google/gemini-cli");
  });

  it("kimi @ uv → uv tool uninstall kimi-cli", () => {
    const plan = buildUninstallPlan(getAgentLifecycleSpec("kimi"), {
      host: "posix",
      installSource: "uv",
    });
    expect(plan?.steps[0]).toMatchObject({ kind: "argv", file: "uv" });
    expect(plan?.preview).toContain("tool");
    expect(plan?.preview).toContain("uninstall");
    expect(plan?.preview).toContain("kimi-cli");
  });

  it("claude @ path → null managed plan", () => {
    const plan = buildUninstallPlan(getAgentLifecycleSpec("claude"), {
      host: "posix",
      installSource: "path",
    });
    expect(plan).toBeNull();
  });

  it("planLifecycle uninstall does not build update plan", () => {
    const plan = planLifecycle(getAgentLifecycleSpec("gemini"), "uninstall", {
      installSource: "npm",
    });
    expect(plan?.preview).toContain("uninstall");
    expect(plan?.preview).not.toMatch(/i -g|install @|upgrade/);
  });

  it("win host + brew source → null (no brew on win)", () => {
    const plan = buildUninstallPlan(getAgentLifecycleSpec("claude"), {
      host: "win",
      installSource: "brew",
    });
    expect(plan).toBeNull();
  });
});
