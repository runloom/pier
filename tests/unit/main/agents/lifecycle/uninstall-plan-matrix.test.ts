import { platform } from "node:os";
import { describe, expect, it } from "vitest";
import { planLifecycle } from "../../../../../src/main/services/agents/lifecycle/plan/build.ts";
import {
  type PlannedInvocation,
  previewPlan,
} from "../../../../../src/main/services/agents/lifecycle/plan/types.ts";
import { buildUninstallPlan } from "../../../../../src/main/services/agents/lifecycle/plan/uninstall.ts";
import { getAgentLifecycleSpec } from "../../../../../src/main/services/agents/lifecycle/specs/index.ts";

/**
 * Mirror of planLifecycle WSL wrap (build.ts): when host===win && distro set,
 * rebuild posix plan and wrap as kind:"wsl". Pure helper so matrix tests the
 * contract on every CI host (node:os mock does not rebind planLifecycle's import).
 */
function wrapUninstallPlanAsWsl(
  distro: string,
  installSource: "npm" | "brew" | "uv" | "pipx" | "path" | "script"
): ReturnType<typeof buildUninstallPlan> {
  const posixPlan = buildUninstallPlan(getAgentLifecycleSpec("gemini"), {
    host: "posix",
    defaultBinPath: null,
    installSource,
  });
  if (!posixPlan) {
    return null;
  }
  const wslStep: PlannedInvocation = {
    kind: "wsl",
    distro,
    inner: posixPlan.steps,
  };
  return {
    steps: [wslStep],
    preview: previewPlan([wslStep]),
  };
}

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

  it("WSL wrap: uninstall + npm builds kind:wsl with posix npm inner (design §4.3)", () => {
    // planLifecycle only wraps when platformKind()==="win"; that gate uses
    // process.platform and is not mockable via vi.mock("node:os") in this
    // Vitest setup. Assert the wrap contract the same way build.ts constructs it:
    // buildUninstallPlan(host:posix, defaultBinPath:null) → kind:"wsl" step.
    const plan = wrapUninstallPlanAsWsl("Ubuntu", "npm");
    expect(plan).not.toBeNull();
    expect(plan?.steps).toHaveLength(1);
    expect(plan?.steps[0]).toMatchObject({
      kind: "wsl",
      distro: "Ubuntu",
    });
    const step = plan?.steps[0];
    if (step?.kind !== "wsl") {
      throw new Error("expected wsl step");
    }
    expect(step.inner[0]).toMatchObject({
      kind: "argv",
      file: "npm",
    });
    expect(plan?.preview).toMatch(/^wsl -d Ubuntu -- /);
    expect(plan?.preview).toContain("uninstall");
    expect(plan?.preview).toContain("@google/gemini-cli");
    expect(plan?.preview).not.toMatch(/i -g|install @|upgrade/);
  });

  it("planLifecycle uninstall: wslDistro on win host → kind:wsl (win CI only)", () => {
    // Live integration when host is Windows; skipped on macOS/Linux CI.
    if (platform() !== "win32") {
      return;
    }
    const plan = planLifecycle(getAgentLifecycleSpec("gemini"), "uninstall", {
      installSource: "npm",
      wslDistro: "Ubuntu",
    });
    expect(plan?.steps[0]).toMatchObject({
      kind: "wsl",
      distro: "Ubuntu",
    });
    expect(plan?.preview).toMatch(/^wsl -d Ubuntu -- /);
    expect(plan?.preview).toContain("uninstall");
  });

  it("planLifecycle uninstall ignores wslDistro on non-win host", () => {
    if (platform() === "win32") {
      return;
    }
    const plan = planLifecycle(getAgentLifecycleSpec("gemini"), "uninstall", {
      installSource: "npm",
      wslDistro: "Ubuntu",
    });
    expect(plan?.steps[0]?.kind).toBe("argv");
    expect(plan?.preview).not.toMatch(/^wsl /);
  });
});
