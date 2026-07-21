import type { ProjectSkillsAcknowledgement } from "../../../shared/contracts/project-skills.ts";
import {
  EnsureReadyTimeout,
  withTimeout,
} from "./launch-gate-attempt-store.ts";
import {
  contentRiskIssueFingerprint,
  hasContentRiskAck,
  issueLines,
  type LaunchContinueDecision,
  type LaunchContinueResult,
  type LaunchGateResult,
  type PendingLaunchAttempt,
  SPAWN_PHASE,
} from "./launch-gate-types.ts";
import type { EnsureReadyResult } from "./repair-service.ts";

export interface ContinueLaunchDeps {
  blockedFromEnsure: (
    result: Extract<EnsureReadyResult, { status: "blocked" }>,
    launchAttemptId: string,
    projectRootPath: string
  ) => LaunchGateResult;
  ensureReady: (args: {
    projectRef: PendingLaunchAttempt["projectRef"];
    agentId: string;
    launchAttemptId: string;
  }) => Promise<EnsureReadyResult>;
  ensureReadyTimeoutMs: number;
  loadDurableAttempt: (
    projectIdentity: PendingLaunchAttempt["projectIdentity"],
    launchAttemptId: string
  ) => Promise<PendingLaunchAttempt | null>;
  now: () => number;
  pending: Map<string, PendingLaunchAttempt>;
  persistAttempt: (record: PendingLaunchAttempt) => Promise<void>;
  sweepMemory: () => void;
}

export async function continueLaunch(
  deps: ContinueLaunchDeps,
  args: {
    launchAttemptId: string;
    decision: LaunchContinueDecision;
    acknowledgements?: readonly ProjectSkillsAcknowledgement[];
  }
): Promise<LaunchContinueResult> {
  deps.sweepMemory();
  let record = deps.pending.get(args.launchAttemptId) ?? null;

  if (!record) {
    return {
      status: "rejected",
      launchAttemptId: args.launchAttemptId,
      reason: "unknown-attempt",
      message: "launch attempt not found or already cleared",
    };
  }

  // Prefer durable phase if it advanced beyond memory (crash recovery).
  const durable = await deps.loadDurableAttempt(
    record.projectIdentity,
    args.launchAttemptId
  );
  if (durable) {
    record = {
      ...record,
      phase: durable.phase,
      degraded: durable.degraded,
      issueSummary: durable.issueSummary,
      issueCodes: durable.issueCodes,
      degradePolicySummary: durable.degradePolicySummary,
      expiresAt: durable.expiresAt,
    };
    deps.pending.set(args.launchAttemptId, record);
  }

  if (
    record.phase === SPAWN_PHASE.SPAWN_INTENT ||
    record.phase === SPAWN_PHASE.SPAWN_AUTHORIZED
  ) {
    return {
      status: "indeterminate",
      launchAttemptId: args.launchAttemptId,
      message:
        "previous spawn intent recorded; result unknown — create a new launch attempt",
    };
  }

  if (
    record.phase === SPAWN_PHASE.SPAWN_ACCEPTED ||
    record.phase === SPAWN_PHASE.SPAWN_FAILED ||
    record.phase === SPAWN_PHASE.CANCELLED
  ) {
    return {
      status: "rejected",
      launchAttemptId: args.launchAttemptId,
      reason:
        record.phase === SPAWN_PHASE.CANCELLED
          ? "already-consumed"
          : "spawn-intent-no-replay",
      message: `launch attempt already ${record.phase.toLowerCase()}`,
    };
  }

  if (deps.now() > record.expiresAt) {
    deps.pending.delete(args.launchAttemptId);
    return {
      status: "rejected",
      launchAttemptId: args.launchAttemptId,
      reason: "expired",
      message: "launch attempt expired",
    };
  }

  if (args.decision === "cancel" || args.decision === "open-settings") {
    const cancelled: PendingLaunchAttempt = {
      ...record,
      phase: SPAWN_PHASE.CANCELLED,
    };
    deps.pending.set(args.launchAttemptId, cancelled);
    await deps.persistAttempt(cancelled);
    deps.pending.delete(args.launchAttemptId);
    return {
      status: "cancelled",
      launchAttemptId: args.launchAttemptId,
      decision: args.decision,
    };
  }

  // decision === "degrade"
  if (record.degradePolicySummary === "denied") {
    return {
      status: "rejected",
      launchAttemptId: args.launchAttemptId,
      reason: "denied",
      message: "degrade denied by policy",
      gate: {
        status: "blocked",
        launchAttemptId: record.launchAttemptId,
        issueSummary: record.issueSummary,
        degradePolicySummary: "denied",
        expiresAt: record.expiresAt,
        projectRootPath: record.projectRef.realPath,
      },
    };
  }

  if (
    record.degradePolicySummary === "requires-content-risk-confirmation" &&
    !hasContentRiskAck(
      args.acknowledgements,
      `launch-degrade-content-risk:${record.launchAttemptId}:${record.healthRevision}`
    )
  ) {
    return {
      status: "rejected",
      launchAttemptId: args.launchAttemptId,
      reason: "acknowledgement-required",
      message:
        "content-risk confirmation acknowledgement required before degrade launch",
      gate: {
        status: "blocked",
        launchAttemptId: record.launchAttemptId,
        issueSummary: record.issueSummary,
        degradePolicySummary: "requires-content-risk-confirmation",
        expiresAt: record.expiresAt,
        projectRootPath: record.projectRef.realPath,
        contentRiskRequirementId: `launch-degrade-content-risk:${record.launchAttemptId}:${record.healthRevision}`,
      },
    };
  }

  // Re-check readiness fingerprint for state drift (same 10s bound).
  let recheck: EnsureReadyResult;
  try {
    recheck = await withTimeout(
      deps.ensureReady({
        projectRef: record.projectRef,
        agentId: record.agentId,
        launchAttemptId: record.launchAttemptId,
      }),
      deps.ensureReadyTimeoutMs
    );
  } catch (error) {
    if (
      error instanceof EnsureReadyTimeout ||
      (error instanceof Error && error.name === "ProjectSkillsLockBusy")
    ) {
      return {
        status: "rejected",
        launchAttemptId: args.launchAttemptId,
        reason: "denied",
        message:
          error instanceof EnsureReadyTimeout
            ? "ensure-ready-timeout"
            : "project-lock-busy",
      };
    }
    throw error;
  }
  if (recheck.status === "blocked") {
    const nextPolicy = recheck.degradePolicySummary;
    const updated: PendingLaunchAttempt = {
      ...record,
      issueSummary: issueLines(recheck.issueSummary),
      issueCodes: recheck.issueSummary.map((i) => i.code),
      degradePolicySummary: nextPolicy,
      healthRevision: contentRiskIssueFingerprint(recheck.issueSummary),
      expiresAt: recheck.expiresAt,
    };
    record = updated;
    deps.pending.set(args.launchAttemptId, updated);
    await deps.persistAttempt(updated);
    if (nextPolicy === "denied") {
      return {
        status: "rejected",
        launchAttemptId: args.launchAttemptId,
        reason: "denied",
        message: "current health denies degraded launch",
        gate: deps.blockedFromEnsure(
          recheck,
          args.launchAttemptId,
          record.projectRef.realPath
        ),
      };
    }
    if (
      nextPolicy === "requires-content-risk-confirmation" &&
      !hasContentRiskAck(
        args.acknowledgements,
        `launch-degrade-content-risk:${record.launchAttemptId}:${record.healthRevision}`
      )
    ) {
      return {
        status: "rejected",
        launchAttemptId: args.launchAttemptId,
        reason: "acknowledgement-required",
        message: "content-risk confirmation required after state change",
        gate: deps.blockedFromEnsure(
          recheck,
          args.launchAttemptId,
          record.projectRef.realPath
        ),
      };
    }
  }

  // Durable PENDING → SPAWN_INTENT before caller may spawn. No auto-replay.
  const degraded = recheck.status === "blocked";
  const intent: PendingLaunchAttempt = {
    ...record,
    phase: SPAWN_PHASE.SPAWN_INTENT,
    degraded,
  };
  deps.pending.set(args.launchAttemptId, intent);
  await deps.persistAttempt(intent);

  return {
    status: "ready",
    launchAttemptId: args.launchAttemptId,
    degraded,
  };
}
