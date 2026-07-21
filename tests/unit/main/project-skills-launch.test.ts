import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSkillsIssue } from "../../../src/main/services/project-skills/health.ts";
import {
  createManagedAgentLaunchGate,
  type LaunchGateResult,
  type ProjectSkillsEnsureReady,
} from "../../../src/main/services/project-skills/launch-gate.ts";
import type { EnsureReadyResult } from "../../../src/main/services/project-skills/repair-service.ts";

function issue(
  code: ProjectSkillsIssue["code"],
  degradePolicy: ProjectSkillsIssue["degradePolicy"]
): ProjectSkillsIssue {
  return {
    id: `${code}-1`,
    code,
    severity: "error",
    scope: "project",
    blockingScopes: ["launch"],
    degradePolicy,
    repairable: false,
    evidence: {},
    checkedAt: Date.now(),
  };
}

function blocked(
  policy: ProjectSkillsIssue["degradePolicy"],
  code: ProjectSkillsIssue["code"] = "unmanaged-conflict"
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

  it("blocks with operation-busy when the correction exceeds the deadline (§5.2.3)", async () => {
    const userData = await mkdtemp(join(tmpdir(), "pier-launch-gate-"));
    dirs.push(userData);
    const gate = createManagedAgentLaunchGate({
      userData,
      // Hung correction: never resolves within the deadline.
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
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") throw new Error("expected blocked");
    expect(result.degradePolicySummary).toBe("denied");
    expect(
      result.issueSummary.some((line) => line.includes("operation-busy"))
    ).toBe(true);
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

  it("blocks when ensureReady reports denied policy", async () => {
    const { gate } = await setup(async ({ launchAttemptId }) => ({
      ...blocked("denied", "ledger-corrupt"),
      launchAttemptId,
    }));
    const result = await gate.ensureReady({
      agentId: "claude",
      projectRootPath: process.cwd(),
    });
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") throw new Error("expected blocked");
    expect(result.degradePolicySummary).toBe("denied");
    expect(
      result.issueSummary.some((line) => line.includes("ledger-corrupt"))
    ).toBe(true);
  });

  it("rejects degrade when policy is denied", async () => {
    const { gate } = await setup(async ({ launchAttemptId }) => ({
      ...blocked("denied"),
      launchAttemptId,
    }));
    const blockedResult = (await gate.ensureReady({
      agentId: "codex",
      projectRootPath: process.cwd(),
    })) as Extract<LaunchGateResult, { status: "blocked" }>;

    const cont = await gate.continueLaunch({
      launchAttemptId: blockedResult.launchAttemptId,
      decision: "degrade",
    });
    expect(cont.status).toBe("rejected");
    if (cont.status !== "rejected") throw new Error("expected rejected");
    expect(cont.reason).toBe("denied");
  });

  it("requires acknowledgement for content-risk degrade", async () => {
    const { gate } = await setup(async ({ launchAttemptId }) => ({
      ...blocked("requires-content-risk-confirmation", "library-drift"),
      launchAttemptId,
    }));
    const blockedResult = (await gate.ensureReady({
      agentId: "claude",
      projectRootPath: process.cwd(),
    })) as Extract<LaunchGateResult, { status: "blocked" }>;

    const withoutAck = await gate.continueLaunch({
      launchAttemptId: blockedResult.launchAttemptId,
      decision: "degrade",
    });
    expect(withoutAck.status).toBe("rejected");
    if (withoutAck.status !== "rejected") throw new Error("expected rejected");
    expect(withoutAck.reason).toBe("acknowledgement-required");

    const withUnrelatedAck = await gate.continueLaunch({
      launchAttemptId: blockedResult.launchAttemptId,
      decision: "degrade",
      acknowledgements: [{ requirementId: "unrelated", nonce: "nonce-1" }],
    });
    expect(withUnrelatedAck.status).toBe("rejected");
    if (withUnrelatedAck.status !== "rejected")
      throw new Error("expected rejected");
    expect(withUnrelatedAck.reason).toBe("acknowledgement-required");

    const withSpoofAck = await gate.continueLaunch({
      launchAttemptId: blockedResult.launchAttemptId,
      decision: "degrade",
      acknowledgements: [
        { requirementId: "launch-degrade:allowed", nonce: "nonce-1" },
        { requirementId: "not-really-content-risk-here", nonce: "nonce-2" },
      ],
    });
    expect(withSpoofAck.status).toBe("rejected");
    if (withSpoofAck.status !== "rejected")
      throw new Error("expected rejected");
    expect(withSpoofAck.reason).toBe("acknowledgement-required");

    const withAck = await gate.continueLaunch({
      launchAttemptId: blockedResult.launchAttemptId,
      decision: "degrade",
      acknowledgements: [
        {
          requirementId:
            blockedResult.contentRiskRequirementId ??
            (() => {
              throw new Error("missing bound content-risk requirement");
            })(),
          nonce: "nonce-1",
        },
      ],
    });
    expect(withAck.status).toBe("ready");
  });

  it("does not mark a launch degraded when the readiness recheck converges", async () => {
    let callCount = 0;
    const { gate } = await setup(async ({ launchAttemptId }) => {
      callCount += 1;
      if (callCount === 1) {
        return { ...blocked("allowed", "projection-missing"), launchAttemptId };
      }
      return { status: "ready", launchAttemptId, repaired: true };
    });
    const initial = await gate.ensureReady({
      agentId: "codex",
      projectRootPath: process.cwd(),
    });
    expect(initial.status).toBe("blocked");
    const continued = await gate.continueLaunch({
      launchAttemptId: initial.launchAttemptId,
      decision: "degrade",
    });
    expect(continued).toMatchObject({ status: "ready", degraded: false });
  });

  it("rejects a content-risk acknowledgement after digest and risk evidence change", async () => {
    let callCount = 0;
    const { gate } = await setup(async ({ launchAttemptId }) => {
      callCount += 1;
      const result = blocked("requires-content-risk-confirmation");
      const contentRiskIssue = result.issueSummary[0];
      if (!contentRiskIssue) throw new Error("expected content-risk issue");
      contentRiskIssue.evidence =
        callCount === 1
          ? {
              contentDigest: "sha256:content-a",
              riskFingerprint: "sha256:risk-a",
            }
          : {
              contentDigest: "sha256:content-b",
              riskFingerprint: "sha256:risk-b",
            };
      return { ...result, launchAttemptId };
    });
    const initial = await gate.ensureReady({
      agentId: "claude",
      projectRootPath: process.cwd(),
    });
    if (initial.status !== "blocked") throw new Error("expected blocked");
    const continued = await gate.continueLaunch({
      launchAttemptId: initial.launchAttemptId,
      decision: "degrade",
      acknowledgements: [
        {
          requirementId:
            initial.contentRiskRequirementId ??
            (() => {
              throw new Error("missing bound requirement");
            })(),
          nonce: "nonce",
        },
      ],
    });
    expect(continued).toMatchObject({
      status: "rejected",
      reason: "acknowledgement-required",
    });
  });

  it("does not auto-replay after SPAWN_INTENT", async () => {
    const { gate } = await setup(async ({ launchAttemptId }) => ({
      ...blocked("allowed", "projection-missing"),
      launchAttemptId,
    }));
    const blockedResult = (await gate.ensureReady({
      agentId: "codex",
      projectRootPath: process.cwd(),
    })) as Extract<LaunchGateResult, { status: "blocked" }>;

    const first = await gate.continueLaunch({
      launchAttemptId: blockedResult.launchAttemptId,
      decision: "degrade",
    });
    expect(first.status).toBe("ready");

    const second = await gate.continueLaunch({
      launchAttemptId: blockedResult.launchAttemptId,
      decision: "degrade",
    });
    expect(second.status).toBe("indeterminate");
  });

  it("authorizes spawn exactly in the SPAWN_INTENT window (continuation handshake)", async () => {
    const { gate } = await setup(async ({ launchAttemptId }) => ({
      ...blocked("allowed", "projection-missing"),
      launchAttemptId,
    }));
    const blockedResult = (await gate.ensureReady({
      agentId: "codex",
      projectRootPath: process.cwd(),
    })) as Extract<LaunchGateResult, { status: "blocked" }>;

    // Not authorized before degrade.
    const spawnFacts = {
      agentId: "codex",
      projectRootPath: process.cwd(),
      surface: { kind: "one-shot" as const },
    };
    const before = await gate.authorizeSpawn(
      blockedResult.launchAttemptId,
      spawnFacts
    );
    expect(before.ok).toBe(false);

    const degraded = await gate.continueLaunch({
      launchAttemptId: blockedResult.launchAttemptId,
      decision: "degrade",
    });
    expect(degraded.status).toBe("ready");

    // Inside the SPAWN_INTENT window: authorized exactly once.
    const auth = await gate.authorizeSpawn(
      blockedResult.launchAttemptId,
      spawnFacts
    );
    expect(auth.ok).toBe(true);
    await gate.recordSpawnResult(blockedResult.launchAttemptId, true);

    // After SPAWN_ACCEPTED: replay rejected.
    const replay = await gate.authorizeSpawn(
      blockedResult.launchAttemptId,
      spawnFacts
    );
    expect(replay.ok).toBe(false);
    if (replay.ok) throw new Error("expected rejection");
    expect(["spawn-intent-no-replay", "unknown-attempt"]).toContain(
      replay.reason
    );
  });

  it("atomically consumes SPAWN_INTENT under concurrent authorization", async () => {
    const { gate } = await setup(async ({ launchAttemptId }) => ({
      ...blocked("allowed", "projection-missing"),
      launchAttemptId,
    }));
    const facts = {
      agentId: "codex",
      launchSpecification: {
        command: "codex",
        cwd: process.cwd(),
        env: { CODEX_MODE: "managed" },
      },
      projectRootPath: process.cwd(),
      surface: {
        kind: "terminal" as const,
        panelId: "panel-1",
        windowId: "window-1",
      },
    };
    const initial = await gate.ensureReady(facts);
    await gate.continueLaunch({
      launchAttemptId: initial.launchAttemptId,
      decision: "degrade",
    });

    const results = await Promise.all([
      gate.authorizeSpawn(initial.launchAttemptId, facts),
      gate.authorizeSpawn(initial.launchAttemptId, facts),
      gate.authorizeSpawn(initial.launchAttemptId, facts),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter(
        (result) => !result.ok && result.reason === "spawn-intent-no-replay"
      )
    ).toHaveLength(2);
    expect(await gate.peekAttemptPhase?.(initial.launchAttemptId)).toBe(
      "SPAWN_AUTHORIZED"
    );
  });

  it("rejects continuation facts that differ from the original launch", async () => {
    const { gate, userData } = await setup(async ({ launchAttemptId }) => ({
      ...blocked("allowed", "projection-missing"),
      launchAttemptId,
    }));
    const facts = {
      agentId: "claude",
      launchSpecification: {
        command: "claude --resume session-1",
        cwd: process.cwd(),
        env: { AUTH_TOKEN: "secret-never-persisted" },
      },
      projectRootPath: process.cwd(),
      surface: {
        kind: "terminal" as const,
        panelId: "panel-1",
        windowId: "window-1",
      },
    };
    const initial = await gate.ensureReady(facts);
    await gate.continueLaunch({
      launchAttemptId: initial.launchAttemptId,
      decision: "degrade",
    });
    const attemptFiles = (await readdir(userData, { recursive: true })).filter(
      (path) => path.endsWith(".json") && path.includes("launch-attempts")
    );
    const durableAttempt = attemptFiles[0];
    if (!durableAttempt) throw new Error("expected durable attempt");
    expect(
      await readFile(join(userData, durableAttempt), "utf8")
    ).not.toContain("secret-never-persisted");

    const mismatches = [
      { ...facts, agentId: "codex" },
      {
        ...facts,
        surface: { ...facts.surface, panelId: "panel-2" },
      },
      {
        ...facts,
        launchSpecification: {
          ...facts.launchSpecification,
          command: "claude --resume another-session",
        },
      },
      {
        ...facts,
        launchSpecification: {
          ...facts.launchSpecification,
          env: { AUTH_TOKEN: "different-secret" },
        },
      },
      {
        ...facts,
        launchSpecification: {
          ...facts.launchSpecification,
          initialInput: "different launch input",
        },
      },
      { ...facts, projectRootPath: userData },
    ];
    for (const mismatch of mismatches) {
      await expect(
        gate.authorizeSpawn(initial.launchAttemptId, mismatch)
      ).resolves.toMatchObject({ ok: false, reason: "launch-mismatch" });
    }
    await expect(
      gate.authorizeSpawn(initial.launchAttemptId, facts)
    ).resolves.toMatchObject({ ok: true });
  });

  it("persists and accepts only the replacement content-risk requirement", async () => {
    let callCount = 0;
    const { gate } = await setup(async ({ launchAttemptId }) => {
      callCount += 1;
      const result = blocked(
        "requires-content-risk-confirmation",
        "library-drift"
      );
      const firstIssue = result.issueSummary[0];
      if (!firstIssue) throw new Error("expected issue");
      firstIssue.evidence = {
        contentDigest:
          callCount === 1 ? "sha256:content-a" : "sha256:content-b",
      };
      return { ...result, launchAttemptId };
    });
    const initial = await gate.ensureReady({
      agentId: "claude",
      projectRootPath: process.cwd(),
    });
    if (initial.status !== "blocked") throw new Error("expected blocked");

    const replacement = await gate.continueLaunch({
      launchAttemptId: initial.launchAttemptId,
      decision: "degrade",
      acknowledgements: [
        {
          requirementId: initial.contentRiskRequirementId ?? "",
          nonce: "initial-ack",
        },
      ],
    });
    expect(replacement).toMatchObject({
      status: "rejected",
      reason: "acknowledgement-required",
    });
    if (
      replacement.status !== "rejected" ||
      replacement.gate?.status !== "blocked"
    ) {
      throw new Error("expected replacement gate");
    }
    expect(replacement.gate.contentRiskRequirementId).not.toBe(
      initial.contentRiskRequirementId
    );

    const continued = await gate.continueLaunch({
      launchAttemptId: initial.launchAttemptId,
      decision: "degrade",
      acknowledgements: [
        {
          requirementId: replacement.gate.contentRiskRequirementId ?? "",
          nonce: "replacement-ack",
        },
      ],
    });
    expect(continued).toMatchObject({ status: "ready", degraded: true });
  });

  it("cancel clears attempt without spawn", async () => {
    const { gate } = await setup(async ({ launchAttemptId }) => ({
      ...blocked("allowed"),
      launchAttemptId,
    }));
    const blockedResult = (await gate.ensureReady({
      agentId: "claude",
      projectRootPath: process.cwd(),
    })) as Extract<LaunchGateResult, { status: "blocked" }>;
    const cancelled = await gate.continueLaunch({
      launchAttemptId: blockedResult.launchAttemptId,
      decision: "cancel",
    });
    expect(cancelled).toEqual({
      status: "cancelled",
      launchAttemptId: blockedResult.launchAttemptId,
      decision: "cancel",
    });
  });
});
