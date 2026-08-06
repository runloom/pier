import { describe, expect, it } from "vitest";
import { planLifecycle } from "../../../../../src/main/services/agents/lifecycle/plan/build.ts";
import { buildUninstallPlan } from "../../../../../src/main/services/agents/lifecycle/plan/uninstall.ts";
import { getAgentLifecycleSpec } from "../../../../../src/main/services/agents/lifecycle/specs/index.ts";

describe("uninstall plan matrix", () => {
  it("claude @ brew → brew uninstall --cask", () => {
    const plan = buildUninstallPlan(getAgentLifecycleSpec("claude"), {
      host: "posix",
      installSource: "brew",
      defaultBinPath: "/opt/homebrew/bin/claude",
    });
    expect(plan?.steps[0]).toMatchObject({
      kind: "argv",
      file: "brew",
    });
    expect(plan?.preview).toMatch(/uninstall/);
    expect(plan?.preview).toMatch(/--cask|claude-code/);
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

  it("kimi @ uv → uv tool uninstall", () => {
    const plan = buildUninstallPlan(getAgentLifecycleSpec("kimi"), {
      host: "posix",
      installSource: "uv",
    });
    expect(plan?.steps[0]).toMatchObject({ kind: "argv", file: "uv" });
    expect(plan?.preview).toContain("tool");
    expect(plan?.preview).toContain("uninstall");
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
