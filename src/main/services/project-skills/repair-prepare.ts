import type { ProjectSkillsAcknowledgement } from "../../../shared/contracts/project-skills.ts";
import {
  computeRepairRequestDigest,
  ProjectSkillsRepairError,
  type ProjectSkillsRepairPlan,
  type ReconcileResult,
  type RepairContext,
  type RepairRecoveryLog,
  type RepairRequest,
  readManifestState,
  readRepairRecoveryLog,
  writeRepairRecoveryLog,
} from "./repair-log.ts";
import { buildRepairPlan, resolveLive } from "./repair-plan-builder.ts";
import { hasRepairHardBlock } from "./repair-plan-finalize.ts";

export async function prepareLog(
  ctx: RepairContext,
  request: RepairRequest
): Promise<RepairRecoveryLog> {
  const { claimed, live, rootKey } = await resolveLive(ctx, request.projectRef);
  if (
    live.volumeId !== claimed.volumeId ||
    live.directoryIdentity !== claimed.directoryIdentity
  ) {
    throw new ProjectSkillsRepairError(
      "not-applied",
      "project identity changed",
      request.operationId
    );
  }

  const liveObserved = await ctx.getObservedRevision(live.realPath);
  if (liveObserved !== request.observedRevision) {
    throw new ProjectSkillsRepairError(
      "revision-conflict",
      "observedRevision mismatch",
      request.operationId
    );
  }

  const existing = await ctx.store.readOperation(rootKey, request.operationId);
  const requestDigestInput: {
    operationId: string;
    repairPlanDigest: string;
    observedRevision: string;
    acknowledgements: readonly ProjectSkillsAcknowledgement[];
    continuationOf?: string;
  } = {
    operationId: request.operationId,
    repairPlanDigest: request.repairPlanDigest,
    observedRevision: request.observedRevision,
    acknowledgements: request.acknowledgements,
  };
  if (request.continuationOf !== undefined) {
    requestDigestInput.continuationOf = request.continuationOf;
  }
  const requestDigest = computeRepairRequestDigest(requestDigestInput);
  if (existing) {
    if (existing.kind === "terminal") {
      if (existing.requestDigest !== requestDigest) {
        throw new ProjectSkillsRepairError(
          "operation-conflict",
          "operationId reused with different request",
          request.operationId
        );
      }
      return {
        schemaVersion: 1,
        kind: "repair",
        operationId: request.operationId,
        requestDigest,
        phase: "FINALIZED",
        projectIdentity: live,
        rootKey,
        observedRevision: request.observedRevision,
        repairPlanDigest: request.repairPlanDigest,
        ...(request.continuationOf === undefined
          ? {}
          : { continuationOf: request.continuationOf }),
        acknowledgements: [...request.acknowledgements],
        plan: (() => {
          const p: ProjectSkillsRepairPlan = {
            observedRevision: request.observedRevision,
            targetOperations: [],
            confirmationRequirements: [],
            blockingIssues: [],
            repairPlanDigest: request.repairPlanDigest,
            executable: true,
            safeAutoFixable: true,
          };
          if (request.continuationOf !== undefined) {
            p.continuationOf = request.continuationOf;
          }
          return p;
        })(),
        manifestPresent: false,
        manifestRevision: null,
        manifestDigest: null,
        targetResults: [],
        pendingIssueIds: [],
        ownershipCommitted: true,
        ownershipTargets: [],
        hadDurableTargetChanges: false,
        finalizedResult: existing.result as ReconcileResult,
      };
    }
    if (existing.requestDigest !== requestDigest) {
      throw new ProjectSkillsRepairError(
        "operation-conflict",
        "operationId reused with different request",
        request.operationId
      );
    }
    const prior = await readRepairRecoveryLog(
      ctx.paths.operationsDir(rootKey),
      request.operationId
    );
    if (prior) return prior;
  }

  const plan = await buildRepairPlan(
    ctx,
    request.projectRef,
    request.observedRevision,
    request.continuationOf
  );
  if (plan.repairPlanDigest !== request.repairPlanDigest) {
    throw new ProjectSkillsRepairError(
      "plan-stale",
      "repairPlanDigest mismatch",
      request.operationId
    );
  }

  const ackIds = new Set(request.acknowledgements.map((a) => a.requirementId));
  for (const req of plan.confirmationRequirements) {
    if (!ackIds.has(req.id)) {
      throw new ProjectSkillsRepairError(
        "acknowledgement-required",
        `missing acknowledgement for ${req.id}`,
        request.operationId
      );
    }
  }

  // Same hard-block set as the planner (single owner) — plus the derived
  // executable flag, so a non-executable plan can never start a transaction.
  if (hasRepairHardBlock(plan.blockingIssues) || !plan.executable) {
    throw new ProjectSkillsRepairError(
      "not-applied",
      "repair blocked by hard issues",
      request.operationId
    );
  }

  const manifestState = await readManifestState(live.realPath);
  const log: RepairRecoveryLog = {
    schemaVersion: 1,
    kind: "repair",
    operationId: request.operationId,
    requestDigest,
    phase: "PREPARED",
    projectIdentity: live,
    rootKey,
    observedRevision: request.observedRevision,
    repairPlanDigest: request.repairPlanDigest,
    acknowledgements: [...request.acknowledgements],
    plan,
    manifestPresent: manifestState.status === "present",
    manifestRevision:
      manifestState.status === "present" ? manifestState.revision : null,
    manifestDigest:
      manifestState.status === "present" ? manifestState.digest : null,
    targetResults: [],
    pendingIssueIds: [],
    ownershipCommitted: false,
    ownershipTargets: [],
    hadDurableTargetChanges: false,
  };
  if (request.continuationOf !== undefined) {
    log.continuationOf = request.continuationOf;
  }

  await writeRepairRecoveryLog(ctx.paths.operationsDir(rootKey), log);
  await ctx.store.writeOperation(rootKey, request.operationId, {
    kind: "in-flight",
    phase: "PREPARED",
    requestDigest,
  });
  return log;
}
