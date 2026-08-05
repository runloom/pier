import { describe, expect, it } from "vitest";
import type { PlannedPlan } from "../../../../../src/main/services/agents/lifecycle/plan/types.ts";
import type { LifecycleRunResult } from "../../../../../src/main/services/agents/lifecycle/runner/types.ts";

/**
 * Mirrors createNodeLifecycleRunner final-result classification for multi-step
 * plans (without spawning). Keeps the "only all-PM-missing → packageManagerMissing"
 * contract checked without mocking node:child_process.
 */
function classifyPlanFailures(
  stepResults: ReadonlyArray<{
    packageManagerMissing?: boolean;
    stderr: string;
    code: number;
    file?: string;
  }>
): Pick<LifecycleRunResult, "ok" | "packageManagerMissing" | "stderr"> {
  let allFailuresWerePmMissing = true;
  const missingManagers: string[] = [];
  const failureNotes: string[] = [];
  let lastStderr = "no steps";

  for (const step of stepResults) {
    if (step.code === 0) {
      return { ok: true, stderr: step.stderr };
    }
    if (step.packageManagerMissing) {
      if (step.file && !missingManagers.includes(step.file)) {
        missingManagers.push(step.file);
      }
      failureNotes.push(`${step.file ?? "pm"}: not found`);
    } else {
      allFailuresWerePmMissing = false;
      failureNotes.push(`${step.file ?? "step"}: ${step.stderr}`);
    }
    lastStderr = step.stderr;
  }

  if (allFailuresWerePmMissing && missingManagers.length > 0) {
    return {
      ok: false,
      packageManagerMissing: true,
      stderr: `Missing: ${missingManagers.join(", ")}`,
    };
  }
  if (failureNotes.length > 1) {
    return { ok: false, stderr: failureNotes.join(" · ") };
  }
  return { ok: false, stderr: lastStderr };
}

describe("lifecycle multi-channel failure classification", () => {
  it("does not mark packageManagerMissing when a later channel succeeds", () => {
    const result = classifyPlanFailures([
      {
        code: 1,
        packageManagerMissing: true,
        file: "pipx",
        stderr: "pipx not found on PATH",
      },
      { code: 0, file: "uv", stderr: "" },
    ]);
    expect(result.ok).toBe(true);
    expect(result.packageManagerMissing).toBeUndefined();
  });

  it("marks packageManagerMissing only when every failed step was a missing PM", () => {
    const result = classifyPlanFailures([
      {
        code: 1,
        packageManagerMissing: true,
        file: "pipx",
        stderr: "pipx not found on PATH",
      },
      {
        code: 1,
        packageManagerMissing: true,
        file: "brew",
        stderr: "brew not found on PATH",
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.packageManagerMissing).toBe(true);
    expect(result.stderr).toBe("Missing: pipx, brew");
  });

  it("uses command_failed shape when a non-PM step also failed", () => {
    const result = classifyPlanFailures([
      {
        code: 1,
        packageManagerMissing: false,
        file: "install script",
        stderr: "curl failed",
      },
      {
        code: 1,
        packageManagerMissing: true,
        file: "pipx",
        stderr: "pipx not found on PATH",
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.packageManagerMissing).toBeUndefined();
    expect(result.stderr).toContain("curl failed");
    expect(result.stderr).toContain("pipx");
  });

  it("aider plan lists uv before pipx (fallback order)", async () => {
    const { buildInstallPlan } = await import(
      "../../../../../src/main/services/agents/lifecycle/plan.ts"
    );
    const { getAgentLifecycleSpec } = await import(
      "../../../../../src/main/services/agents/lifecycle/specs/index.ts"
    );
    const plan: PlannedPlan | null = buildInstallPlan(
      getAgentLifecycleSpec("aider"),
      "posix"
    );
    expect(plan).not.toBeNull();
    const argvFiles = (plan?.steps ?? [])
      .filter((s) => s.kind === "argv")
      .map((s) => (s.kind === "argv" ? s.file : ""));
    expect(argvFiles.indexOf("uv")).toBeLessThan(argvFiles.indexOf("pipx"));
  });
});
