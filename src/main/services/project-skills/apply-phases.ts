import type { ApplyResult } from "../../../shared/contracts/project-skills.ts";
import { minimalSnapshot } from "./apply-content.ts";
import {
  type ApplyCtx,
  type ApplyHookContext,
  type ApplyRecoveryLog,
  type ApplyTransactionPhase,
  isPhaseAtLeast,
  ProjectSkillsApplyError,
} from "./apply-log.ts";
import { writeApplyRecoveryLog } from "./apply-log-io.ts";
import {
  buildCleanupPlans,
  cleanupCommittedReplacementBackups,
  commitManifest,
  publishLibraryFromStaging,
  runCleanup,
} from "./apply-phases-content.ts";
import { rollbackPreCommit } from "./apply-phases-rollback.ts";
import { commitOwnership, reconcileTargets } from "./apply-phases-targets.ts";
import { toContractProjectRootRef } from "./identity.ts";

async function advancePhase(
  ctx: ApplyCtx,
  log: ApplyRecoveryLog,
  phase: ApplyTransactionPhase
): Promise<void> {
  log.phase = phase;
  await writeApplyRecoveryLog(ctx.paths.operationsDir(log.rootKey), log);
  await ctx.store.writeOperation(log.rootKey, log.operationId, {
    kind: "in-flight",
    phase,
    requestDigest: log.requestDigest,
  });
  // Sync parent dir of recovery artifacts (best-effort durability).
  await ctx.fs
    .syncDirectory(ctx.paths.operationsDir(log.rootKey))
    .catch(() => undefined);
}

async function runHook(
  ctx: ApplyCtx,
  which: "before" | "after",
  phase: ApplyTransactionPhase,
  log: ApplyRecoveryLog
): Promise<void> {
  const hookCtx: ApplyHookContext = {
    operationId: log.operationId,
    rootKey: log.rootKey,
    phase,
    projectRoot: log.projectIdentity.realPath,
  };
  if (which === "before") {
    await ctx.hooks?.beforePhase?.(phase, hookCtx);
  } else {
    await ctx.hooks?.afterPhase?.(phase, hookCtx);
  }
}

function hookContext(log: ApplyRecoveryLog): ApplyHookContext {
  return {
    operationId: log.operationId,
    rootKey: log.rootKey,
    phase: log.phase,
    projectRoot: log.projectIdentity.realPath,
  };
}

async function finalizeTerminal(
  ctx: ApplyCtx,
  log: ApplyRecoveryLog,
  result:
    | ApplyResult
    | { status: "not-applied"; operationId: string; reason?: string }
): Promise<ApplyResult | { status: "not-applied"; operationId: string }> {
  log.phase = "FINALIZED";
  log.finalizedResult = result;
  await writeApplyRecoveryLog(ctx.paths.operationsDir(log.rootKey), log);

  if (result.status === "not-applied") {
    await ctx.store.writeOperation(log.rootKey, log.operationId, {
      kind: "terminal",
      status: "not-applied",
      requestDigest: log.requestDigest,
      result,
    });
    return result;
  }

  let terminalStatus: "converged" | "degraded" | "not-applied" = "not-applied";
  if (result.status === "converged") {
    terminalStatus = "converged";
  } else if (result.status === "degraded") {
    terminalStatus = "degraded";
  }

  // indeterminate is not a durable terminal for store — keep in-flight.
  if (result.status === "indeterminate") {
    await ctx.store.writeOperation(log.rootKey, log.operationId, {
      kind: "in-flight",
      phase: log.phase,
      requestDigest: log.requestDigest,
    });
    return result;
  }

  await ctx.store.writeOperation(log.rootKey, log.operationId, {
    kind: "terminal",
    status: terminalStatus === "not-applied" ? "not-applied" : terminalStatus,
    requestDigest: log.requestDigest,
    result,
  });
  return result;
}

async function persistRollbackIntent(
  ctx: ApplyCtx,
  log: ApplyRecoveryLog,
  reason: string
): Promise<void> {
  if (log.rollbackIntent) return;
  log.rollbackIntent = { reason, startedAt: ctx.now() };
  await writeApplyRecoveryLog(ctx.paths.operationsDir(log.rootKey), log);
  await ctx.store.writeOperation(log.rootKey, log.operationId, {
    kind: "in-flight",
    phase: "ROLLING_BACK",
    requestDigest: log.requestDigest,
  });
  await ctx.fs
    .syncDirectory(ctx.paths.operationsDir(log.rootKey))
    .catch(() => undefined);
  await ctx.hooks?.afterRollbackIntent?.(hookContext(log));
}

async function rollbackToNotApplied(
  ctx: ApplyCtx,
  log: ApplyRecoveryLog,
  reason: string
): Promise<{ status: "not-applied"; operationId: string }> {
  await persistRollbackIntent(ctx, log, reason);
  await rollbackPreCommit(ctx, log);
  return (await finalizeTerminal(ctx, log, {
    status: "not-applied",
    operationId: log.operationId,
    reason: log.rollbackIntent?.reason ?? reason,
  })) as { status: "not-applied"; operationId: string };
}

/**
 * Post-transaction observed revision (design §3.2): recomputed after the
 * terminal state is reached so `revisions.observedRevision` and the
 * invalidated broadcast describe the NEW on-disk state, not the request
 * baseline.
 */
async function finalObservedRevision(
  ctx: ApplyCtx,
  log: ApplyRecoveryLog
): Promise<string> {
  return await ctx
    .getObservedRevision(log.projectIdentity.realPath)
    .catch(() => log.observedRevision);
}

function buildResult(
  log: ApplyRecoveryLog,
  observedRevision: string
): ApplyResult {
  const projectRef = toContractProjectRootRef(log.projectIdentity);
  const pending = [...new Set(log.pendingIssueIds)];
  const snapshot = minimalSnapshot({
    projectRef,
    manifest: log.nextManifest,
    manifestRevision: log.manifestRevision,
    observedRevision,
    pendingIssueIds: pending,
  });
  const revisions = {
    manifestRevision: log.manifestRevision ?? `sha256:${"0".repeat(64)}`,
    observedRevision,
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

/**
 * Drive the state machine from the current recovery log phase forward.
 */
export async function drive(
  ctx: ApplyCtx,
  log: ApplyRecoveryLog
): Promise<ApplyResult | { status: "not-applied"; operationId: string }> {
  try {
    if (log.rollbackIntent) {
      return await rollbackToNotApplied(ctx, log, log.rollbackIntent.reason);
    }

    if (
      log.manifestCommitted ||
      isPhaseAtLeast(log.phase, "MANIFEST_COMMITTED")
    ) {
      await ctx.hooks?.beforeCommittedBackupCleanup?.(hookContext(log));
      await cleanupCommittedReplacementBackups(ctx, log);
    }

    // PREPARED is written before first project write.
    if (!isPhaseAtLeast(log.phase, "PREPARED")) {
      await runHook(ctx, "before", "PREPARED", log);
      await advancePhase(ctx, log, "PREPARED");
      await runHook(ctx, "after", "PREPARED", log);
    }

    if (!isPhaseAtLeast(log.phase, "CONTENT_PUBLISHED")) {
      await runHook(ctx, "before", "CONTENT_PUBLISHED", log);
      // Claim tokens first.
      for (const token of log.draft.importTokens ?? []) {
        const candidate = await ctx.store.readCandidate(log.rootKey, token);
        if (!candidate) continue;
        if (candidate.state === "AVAILABLE") {
          if (candidate.expiresAt <= ctx.now()) {
            throw new ProjectSkillsApplyError(
              "token-expired",
              `import token expired: ${token}`,
              log.operationId
            );
          }
          await ctx.store.claimCandidate(log.rootKey, token, log.operationId);
          if (!log.claimedTokens.includes(token)) {
            log.claimedTokens.push(token);
          }
        } else if (
          candidate.state === "CLAIMED" &&
          candidate.operationId === log.operationId &&
          !log.claimedTokens.includes(token)
        ) {
          log.claimedTokens.push(token);
        }
      }
      await writeApplyRecoveryLog(ctx.paths.operationsDir(log.rootKey), log);
      await publishLibraryFromStaging(ctx, log);
      await buildCleanupPlans(ctx, log);
      await advancePhase(ctx, log, "CONTENT_PUBLISHED");
      await runHook(ctx, "after", "CONTENT_PUBLISHED", log);
    }

    if (!isPhaseAtLeast(log.phase, "MANIFEST_COMMITTED")) {
      await runHook(ctx, "before", "MANIFEST_COMMITTED", log);
      if (!log.manifestCommitted) {
        await commitManifest(ctx, log);
      }
      await advancePhase(ctx, log, "MANIFEST_COMMITTED");
      await ctx.hooks?.beforeCommittedBackupCleanup?.(hookContext(log));
      await cleanupCommittedReplacementBackups(ctx, log);
      await runHook(ctx, "after", "MANIFEST_COMMITTED", log);
    }

    // ---- post-commit boundary ----

    if (!isPhaseAtLeast(log.phase, "RECONCILING_TARGETS")) {
      await runHook(ctx, "before", "RECONCILING_TARGETS", log);
      await reconcileTargets(ctx, log);
      await advancePhase(ctx, log, "RECONCILING_TARGETS");
      await runHook(ctx, "after", "RECONCILING_TARGETS", log);
    }

    if (!isPhaseAtLeast(log.phase, "OWNERSHIP_COMMITTED")) {
      await runHook(ctx, "before", "OWNERSHIP_COMMITTED", log);
      await commitOwnership(ctx, log);
      await runCleanup(ctx, log);
      await advancePhase(ctx, log, "OWNERSHIP_COMMITTED");
      await runHook(ctx, "after", "OWNERSHIP_COMMITTED", log);
    }

    if (!isPhaseAtLeast(log.phase, "FINALIZED")) {
      await runHook(ctx, "before", "FINALIZED", log);
      const result = buildResult(log, await finalObservedRevision(ctx, log));
      const finalized = await finalizeTerminal(ctx, log, result);
      // Reclaim consumed staging after the transaction is durable.
      for (const published of log.publishedLibrary) {
        if (!published.fromImportToken) continue;
        await ctx.store
          .destroyConsumed(
            log.rootKey,
            published.fromImportToken,
            log.operationId
          )
          .catch(() => undefined);
      }
      await runHook(ctx, "after", "FINALIZED", log);
      return finalized;
    }

    if (log.finalizedResult) {
      return log.finalizedResult as
        | ApplyResult
        | {
            status: "not-applied";
            operationId: string;
          };
    }
    const result = buildResult(log, await finalObservedRevision(ctx, log));
    return await finalizeTerminal(ctx, log, result);
  } catch (error) {
    if (log.rollbackIntent) {
      await writeApplyRecoveryLog(ctx.paths.operationsDir(log.rootKey), log);
      await ctx.store.writeOperation(log.rootKey, log.operationId, {
        kind: "in-flight",
        phase: "ROLLING_BACK",
        requestDigest: log.requestDigest,
      });
      throw error;
    }
    if (error instanceof ProjectSkillsApplyError) {
      if (error.code === "not-applied" && !log.manifestCommitted) {
        return await rollbackToNotApplied(ctx, log, error.message);
      }
      if (error.code === "indeterminate") {
        // Keep non-terminal log and return the contract indeterminate
        // payload so the renderer freezes writes and polls (design §7.7).
        await writeApplyRecoveryLog(ctx.paths.operationsDir(log.rootKey), log);
        await ctx.store.writeOperation(log.rootKey, log.operationId, {
          kind: "in-flight",
          phase: log.phase,
          requestDigest: log.requestDigest,
        });
        return {
          status: "indeterminate",
          operationId: log.operationId,
          lastConfirmedObservedRevision: log.observedRevision,
          ...(log.manifestRevision
            ? { manifestRevision: log.manifestRevision }
            : {}),
          operationStatusQuery: {
            projectRef: toContractProjectRootRef(log.projectIdentity),
            operationId: log.operationId,
          },
        };
      }
    }

    // Pre-commit failure (including injected hooks before MANIFEST_COMMITTED).
    if (!log.manifestCommitted) {
      const reason = error instanceof Error ? error.message : String(error);
      await rollbackToNotApplied(ctx, log, reason);
      throw new ProjectSkillsApplyError("not-applied", reason, log.operationId);
    }

    // Post-commit crash: leave in-flight for recovery. Re-throw.
    await writeApplyRecoveryLog(ctx.paths.operationsDir(log.rootKey), log);
    await ctx.store.writeOperation(log.rootKey, log.operationId, {
      kind: "in-flight",
      phase: log.phase,
      requestDigest: log.requestDigest,
    });
    throw error;
  }
}
