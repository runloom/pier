import { readlink, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ProjectRootRef as ContractProjectRootRef,
  ProjectSkillsManifest,
} from "../../../shared/contracts/project-skills.ts";
import { toContractProjectRootRef } from "./identity.ts";
import {
  ensureDir,
  isErrno,
  isPhaseAtLeast,
  ownershipIdentityForStore,
  ProjectSkillsRepairError,
  projectIdentityKey,
  type ReconcileResult,
  type RepairContext,
  type RepairRecoveryLog,
  type RepairTransactionPhase,
  readManifestState,
  sameIdentity,
  type TargetOpResult,
  writeRepairRecoveryLog,
} from "./repair-log.ts";
import type { OperationTerminalStatus, OwnershipRecord } from "./store.ts";

export function minimalSnapshot(args: {
  projectRef: ContractProjectRootRef;
  manifest: ProjectSkillsManifest | null;
  manifestRevision: string | null;
  observedRevision: string;
  pendingIssueIds: string[];
}): unknown {
  return {
    projectRef: args.projectRef,
    manifestRevision: args.manifestRevision,
    observedRevision: args.observedRevision,
    manifest: args.manifest,
    pendingIssueIds: args.pendingIssueIds,
    skills: args.manifest?.skills ?? [],
  };
}

async function reconcileTargets(
  ctx: RepairContext,
  log: RepairRecoveryLog
): Promise<void> {
  const projectRoot = log.projectIdentity.realPath;
  const ownership = await ctx.store.readOwnership(log.rootKey);
  const ownedByPath = new Map(
    (ownership?.targets ?? []).map((t) => [t.relativePath, t] as const)
  );
  const nextTargets = new Map(
    (ownership?.targets ?? []).map((t) => [t.relativePath, t] as const)
  );
  const results: TargetOpResult[] = [...log.targetResults];
  const done = new Set(
    results
      .filter(
        (r) =>
          r.status === "created" ||
          r.status === "deleted" ||
          r.status === "noop"
      )
      .map((r) => r.relativeTarget)
  );

  for (const op of log.plan.targetOperations) {
    if (done.has(op.relativeTarget)) continue;
    if (op.kind === "noop") {
      results.push({
        relativeTarget: op.relativeTarget,
        skillId: op.skillId,
        kind: op.kind,
        status: "noop",
      });
      continue;
    }

    const absolute = join(projectRoot, ...op.relativeTarget.split("/"));

    if (op.kind === "create-symlink") {
      await ensureDir(dirname(absolute));
      try {
        const existing = await ctx.fs.lstatIdentity(absolute);
        if (existing.isSymbolicLink) {
          const target = await readlink(absolute);
          const owned = ownedByPath.get(op.relativeTarget);
          if (
            target === op.expectedRelativeLinkTarget &&
            owned &&
            sameIdentity(owned.objectIdentity, existing)
          ) {
            results.push({
              relativeTarget: op.relativeTarget,
              skillId: op.skillId,
              kind: op.kind,
              status: "noop",
            });
            continue;
          }
        }
        results.push({
          relativeTarget: op.relativeTarget,
          skillId: op.skillId,
          kind: op.kind,
          status: "failed",
          reason: "unmanaged-conflict",
        });
        log.pendingIssueIds.push(`unmanaged-conflict:${op.relativeTarget}`);
        continue;
      } catch (error) {
        if (!isErrno(error, "ENOENT")) throw error;
      }

      const published = await ctx.fs.publishSymlinkNoReplace({
        linkPath: absolute,
        relativeTarget: op.expectedRelativeLinkTarget,
      });
      if (published.status === "conflict") {
        results.push({
          relativeTarget: op.relativeTarget,
          skillId: op.skillId,
          kind: op.kind,
          status: "failed",
          reason: published.reason,
        });
        log.pendingIssueIds.push(`unmanaged-conflict:${op.relativeTarget}`);
        continue;
      }
      log.hadDurableTargetChanges = true;
      nextTargets.set(op.relativeTarget, {
        relativePath: op.relativeTarget,
        skillId: op.skillId,
        expectedRelativeLinkTarget: op.expectedRelativeLinkTarget,
        objectIdentity: published.identity,
        createdByOperationId: log.operationId,
        createdAt: ctx.now(),
      });
      results.push({
        relativeTarget: op.relativeTarget,
        skillId: op.skillId,
        kind: op.kind,
        status: "created",
      });
      continue;
    }

    if (op.kind === "delete-symlink") {
      const owned = ownedByPath.get(op.relativeTarget);
      try {
        const current = await ctx.fs.lstatIdentity(absolute);
        if (!current.isSymbolicLink) {
          results.push({
            relativeTarget: op.relativeTarget,
            skillId: op.skillId,
            kind: op.kind,
            status: "failed",
            reason: "not-symlink",
          });
          log.pendingIssueIds.push(
            `managed-target-modified:${op.relativeTarget}`
          );
          continue;
        }
        if (!owned) {
          results.push({
            relativeTarget: op.relativeTarget,
            skillId: op.skillId,
            kind: op.kind,
            status: "failed",
            reason: "no-ownership",
          });
          log.pendingIssueIds.push(
            `managed-target-modified:${op.relativeTarget}`
          );
          continue;
        }
        const linkTarget = await readlink(absolute);
        if (
          !sameIdentity(owned.objectIdentity, current) ||
          linkTarget !== owned.expectedRelativeLinkTarget
        ) {
          results.push({
            relativeTarget: op.relativeTarget,
            skillId: op.skillId,
            kind: op.kind,
            status: "failed",
            reason: "identity-or-target-mismatch",
          });
          log.pendingIssueIds.push(
            `managed-target-modified:${op.relativeTarget}`
          );
          continue;
        }
        await unlink(absolute);
        log.hadDurableTargetChanges = true;
        nextTargets.delete(op.relativeTarget);
        results.push({
          relativeTarget: op.relativeTarget,
          skillId: op.skillId,
          kind: op.kind,
          status: "deleted",
        });
      } catch (error) {
        if (isErrno(error, "ENOENT")) {
          nextTargets.delete(op.relativeTarget);
          results.push({
            relativeTarget: op.relativeTarget,
            skillId: op.skillId,
            kind: op.kind,
            status: "noop",
            reason: "already-absent",
          });
          continue;
        }
        throw error;
      }
    }
  }

  log.targetResults = results;
  log.ownershipTargets = [...nextTargets.values()].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath)
  );
}

async function commitOwnership(
  ctx: RepairContext,
  log: RepairRecoveryLog
): Promise<void> {
  if (log.ownershipCommitted) return;
  const current = await ctx.store.readOwnership(log.rootKey);
  const generation = current?.generation ?? 0;
  const next: OwnershipRecord = {
    schemaVersion: 1,
    generation: generation + 1,
    projectIdentity: log.projectIdentity,
    targets: log.ownershipTargets.map((t) => ({
      ...t,
      objectIdentity: ownershipIdentityForStore(t.objectIdentity),
    })),
  };
  await ctx.store.commitOwnership(log.rootKey, generation, next);
  log.ownershipCommitted = true;
}

async function advancePhase(
  ctx: RepairContext,
  log: RepairRecoveryLog,
  phase: RepairTransactionPhase
): Promise<void> {
  log.phase = phase;
  await writeRepairRecoveryLog(ctx.paths.operationsDir(log.rootKey), log);
  await ctx.store.writeOperation(log.rootKey, log.operationId, {
    kind: "in-flight",
    phase,
    requestDigest: log.requestDigest,
  });
}

async function finalizeTerminal(
  ctx: RepairContext,
  log: RepairRecoveryLog,
  result: ReconcileResult
): Promise<ReconcileResult> {
  log.phase = "FINALIZED";
  log.finalizedResult = result;
  await writeRepairRecoveryLog(ctx.paths.operationsDir(log.rootKey), log);
  let terminalStatus: OperationTerminalStatus = "degraded";
  if (
    result.status === "converged" ||
    result.status === "degraded" ||
    result.status === "superseded" ||
    result.status === "not-applied"
  ) {
    terminalStatus = result.status;
  }
  await ctx.store.writeOperation(log.rootKey, log.operationId, {
    kind: "terminal",
    status: terminalStatus,
    requestDigest: log.requestDigest,
    result,
  });
  if (
    result.status === "converged" ||
    result.status === "degraded" ||
    result.status === "superseded"
  ) {
    ctx.onInvalidated?.({
      projectIdentity: projectIdentityKey(log.projectIdentity),
      observedRevision: log.observedRevision,
    });
  }
  return result;
}

function buildResult(
  log: RepairRecoveryLog,
  manifest: ProjectSkillsManifest | null
): ReconcileResult {
  const projectRef = toContractProjectRootRef(log.projectIdentity);
  const pending = [...new Set(log.pendingIssueIds)];
  const snapshot = minimalSnapshot({
    projectRef,
    manifest,
    manifestRevision: log.manifestRevision,
    observedRevision: log.observedRevision,
    pendingIssueIds: pending,
  });
  const revisions = {
    manifestRevision: log.manifestRevision ?? `sha256:${"0".repeat(64)}`,
    observedRevision: log.observedRevision,
  };
  if (pending.length > 0) {
    return {
      status: "degraded",
      operationId: log.operationId,
      revisions,
      targetResults: log.targetResults,
      snapshot,
      pendingIssueIds: pending,
    };
  }
  return {
    status: "converged",
    operationId: log.operationId,
    revisions,
    targetResults: log.targetResults,
    snapshot,
  };
}

export async function drive(
  ctx: RepairContext,
  log: RepairRecoveryLog
): Promise<ReconcileResult> {
  try {
    if (!isPhaseAtLeast(log.phase, "PREPARED")) {
      await advancePhase(ctx, log, "PREPARED");
    }

    if (!isPhaseAtLeast(log.phase, "MANIFEST_CONFIRMED")) {
      // Re-confirm manifest identity under lock; never rewrite it.
      const state = await readManifestState(log.projectIdentity.realPath);
      if (log.manifestPresent) {
        if (state.status !== "present") {
          if (log.hadDurableTargetChanges) {
            return await finalizeTerminal(ctx, log, {
              status: "superseded",
              operationId: log.operationId,
              hadDurableTargetChanges: true,
              baselineObservedRevision: log.observedRevision,
              currentObservedRevision: await ctx
                .getObservedRevision(log.projectIdentity.realPath)
                .catch(() => log.observedRevision),
              snapshot: minimalSnapshot({
                projectRef: toContractProjectRootRef(log.projectIdentity),
                manifest: null,
                manifestRevision: null,
                observedRevision: log.observedRevision,
                pendingIssueIds: ["manifest-changed"],
              }),
              targetResults: log.targetResults,
            });
          }
          return await finalizeTerminal(ctx, log, {
            status: "not-applied",
            operationId: log.operationId,
            reason: "superseded",
          });
        }
        if (log.manifestDigest && state.digest !== log.manifestDigest) {
          if (log.hadDurableTargetChanges) {
            return await finalizeTerminal(ctx, log, {
              status: "superseded",
              operationId: log.operationId,
              hadDurableTargetChanges: true,
              baselineObservedRevision: log.observedRevision,
              currentObservedRevision: await ctx
                .getObservedRevision(log.projectIdentity.realPath)
                .catch(() => log.observedRevision),
              snapshot: minimalSnapshot({
                projectRef: toContractProjectRootRef(log.projectIdentity),
                manifest: state.manifest,
                manifestRevision: state.revision,
                observedRevision: log.observedRevision,
                pendingIssueIds: ["manifest-changed"],
              }),
              targetResults: log.targetResults,
            });
          }
          return await finalizeTerminal(ctx, log, {
            status: "not-applied",
            operationId: log.operationId,
            reason: "superseded",
          });
        }
        log.manifestRevision = state.revision;
      } else if (state.status === "present") {
        // Started without manifest; one appeared → superseded if needed.
        if (log.hadDurableTargetChanges) {
          return await finalizeTerminal(ctx, log, {
            status: "superseded",
            operationId: log.operationId,
            hadDurableTargetChanges: true,
            baselineObservedRevision: log.observedRevision,
            currentObservedRevision: await ctx
              .getObservedRevision(log.projectIdentity.realPath)
              .catch(() => log.observedRevision),
            snapshot: minimalSnapshot({
              projectRef: toContractProjectRootRef(log.projectIdentity),
              manifest: state.manifest,
              manifestRevision: state.revision,
              observedRevision: log.observedRevision,
              pendingIssueIds: ["manifest-appeared"],
            }),
            targetResults: log.targetResults,
          });
        }
        return await finalizeTerminal(ctx, log, {
          status: "not-applied",
          operationId: log.operationId,
          reason: "superseded",
        });
      }
      await advancePhase(ctx, log, "MANIFEST_CONFIRMED");
    }

    if (!isPhaseAtLeast(log.phase, "RECONCILING_TARGETS")) {
      await reconcileTargets(ctx, log);
      await advancePhase(ctx, log, "RECONCILING_TARGETS");
    }

    if (!isPhaseAtLeast(log.phase, "OWNERSHIP_COMMITTED")) {
      await commitOwnership(ctx, log);
      await advancePhase(ctx, log, "OWNERSHIP_COMMITTED");
    }

    if (!isPhaseAtLeast(log.phase, "FINALIZED")) {
      const state = await readManifestState(log.projectIdentity.realPath);
      const manifest = state.status === "present" ? state.manifest : null;
      const result = buildResult(log, manifest);
      return await finalizeTerminal(ctx, log, result);
    }

    if (log.finalizedResult) return log.finalizedResult;
    const state = await readManifestState(log.projectIdentity.realPath);
    return await finalizeTerminal(
      ctx,
      log,
      buildResult(log, state.status === "present" ? state.manifest : null)
    );
  } catch (error) {
    if (
      error instanceof ProjectSkillsRepairError &&
      error.code === "indeterminate"
    ) {
      await writeRepairRecoveryLog(ctx.paths.operationsDir(log.rootKey), log);
      await ctx.store.writeOperation(log.rootKey, log.operationId, {
        kind: "in-flight",
        phase: log.phase,
        requestDigest: log.requestDigest,
      });
      return {
        status: "indeterminate" as const,
        operationId: log.operationId,
        lastConfirmedObservedRevision: log.observedRevision,
        operationStatusQuery: {
          projectRef: toContractProjectRootRef(log.projectIdentity),
          operationId: log.operationId,
        },
      };
    }

    // Pre-target failure → not-applied.
    if (!log.hadDurableTargetChanges) {
      return await finalizeTerminal(ctx, log, {
        status: "not-applied",
        operationId: log.operationId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    await writeRepairRecoveryLog(ctx.paths.operationsDir(log.rootKey), log);
    await ctx.store.writeOperation(log.rootKey, log.operationId, {
      kind: "in-flight",
      phase: log.phase,
      requestDigest: log.requestDigest,
    });
    throw error;
  }
}
