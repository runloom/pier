import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSkillsIssue } from "../../../../src/main/services/project-skills/health.ts";
import {
  createManagedAgentLaunchGate,
  type ProjectSkillsEnsureReady,
} from "../../../../src/main/services/project-skills/launch-gate/index.ts";
import type { EnsureReadyResult } from "../../../../src/main/services/project-skills/repair/service.ts";

function issue(
  code: ProjectSkillsIssue["code"],
  degradePolicy: ProjectSkillsIssue["degradePolicy"]
): ProjectSkillsIssue {
  return {
    id: `${code}-1`,
    code,
    severity: "error",
    scope: "project",
    blockingScopes: [],
    degradePolicy,
    repairable: false,
    evidence: {},
    checkedAt: Date.now(),
  };
}

function blocked(
  policy: ProjectSkillsIssue["degradePolicy"],
  code: ProjectSkillsIssue["code"] = "ledger-corrupt"
): Extract<EnsureReadyResult, { status: "blocked" }> {
  const i = issue(code, policy);
  return {
    status: "blocked",
    launchAttemptId: "attempt-1",
    issueSummary: [i],
    degradePolicySummary: policy,
    expiresAt: Date.now() + 120_000,
  };
}

describe("ManagedAgentLaunchGate", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
    );
  });

  async function setup(ensureImpl: ProjectSkillsEnsureReady) {
    const userData = await mkdtemp(join(tmpdir(), "pier-launch-gate-"));
    dirs.push(userData);
    const ensureReady = vi.fn(ensureImpl);
    const gate = createManagedAgentLaunchGate({
      userData,
      ensureReady,
      createId: () => "attempt-fixed",
    });
    return { gate, ensureReady, userData };
  }

  it("returns ready when the correction exceeds the deadline (never blocks spawn)", async () => {
    const userData = await mkdtemp(join(tmpdir(), "pier-launch-gate-"));
    dirs.push(userData);
    const gate = createManagedAgentLaunchGate({
      userData,
      ensureReady: () =>
        new Promise<EnsureReadyResult>((resolve) => {
          setTimeout(() => {
            resolve({ status: "ready", launchAttemptId: "x", repaired: false });
          }, 5000);
        }),
      createId: () => "attempt-timeout",
      ensureReadyTimeoutMs: 25,
    });
    const result = await gate.ensureReady({
      agentId: "claude",
      projectRootPath: process.cwd(),
    });
    expect(result).toEqual({
      status: "ready",
      launchAttemptId: "attempt-timeout",
    });
  });

  it("returns ready without calling ensureReady for non-applicable agents", async () => {
    const { gate, ensureReady } = await setup(async () => ({
      status: "ready",
      launchAttemptId: "x",
      repaired: false,
    }));
    // kiro is registered as audit evidence but scans only private roots
    // (consumesProjectSkills: false) — never gated.
    const result = await gate.ensureReady({
      agentId: "kiro",
      projectRootPath: process.cwd(),
    });
    expect(result).toEqual({
      status: "ready",
      launchAttemptId: "attempt-fixed",
    });
    expect(ensureReady).not.toHaveBeenCalled();
  });

  it("returns ready even when the repair injector reports blocked", async () => {
    const { gate } = await setup(async ({ launchAttemptId }) => ({
      ...blocked("denied", "ledger-corrupt"),
      launchAttemptId,
    }));
    const result = await gate.ensureReady({
      agentId: "claude",
      projectRootPath: process.cwd(),
    });
    expect(result).toEqual({
      status: "ready",
      launchAttemptId: "attempt-fixed",
    });
  });

  it("returns ready on a healthy ensureReady path", async () => {
    const { gate, ensureReady } = await setup(async ({ launchAttemptId }) => ({
      status: "ready",
      launchAttemptId,
      repaired: true,
    }));
    const result = await gate.ensureReady({
      agentId: "codex",
      projectRootPath: process.cwd(),
    });
    expect(result).toEqual({
      status: "ready",
      launchAttemptId: "attempt-fixed",
    });
    expect(ensureReady).toHaveBeenCalledOnce();
  });
});
