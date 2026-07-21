import { readlink, unlink } from "node:fs/promises";
import { join, posix } from "node:path";
import { expectedLinkTarget } from "./apply-content.ts";
import {
  type ApplyCtx,
  type ApplyRecoveryLog,
  isErrno,
  ownershipIdentityForStore,
  sameIdentity,
  type TargetOpResult,
} from "./apply-log.ts";
import { ensureProjectRelativeDir } from "./path-containment.ts";
import type { OwnershipRecord, OwnershipTarget } from "./store.ts";

export async function reconcileTargets(
  ctx: ApplyCtx,
  log: ApplyRecoveryLog
): Promise<void> {
  const projectRoot = log.projectIdentity.realPath;
  const ownership = await ctx.store.readOwnership(log.rootKey);
  const ownedByPath = new Map(
    (ownership?.targets ?? []).map((t) => [t.relativePath, t] as const)
  );
  // Start from existing ownership; mutate as we go.
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
    const absolute = join(projectRoot, ...op.relativeTarget.split("/"));

    if (op.kind === "noop") {
      results.push({
        relativeTarget: op.relativeTarget,
        skillId: op.skillId,
        kind: op.kind,
        status: "noop",
      });
      continue;
    }

    if (op.kind === "create-symlink") {
      const parentRelative = posix.dirname(op.relativeTarget);
      if (parentRelative !== "." && parentRelative !== "") {
        await ensureProjectRelativeDir(projectRoot, parentRelative);
      }
      // If already correct owned link, noop.
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
        // Something else is there.
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
        projectRoot,
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
      const target: OwnershipTarget = {
        relativePath: op.relativeTarget,
        skillId: op.skillId,
        expectedRelativeLinkTarget: op.expectedRelativeLinkTarget,
        objectIdentity: published.identity,
        createdByOperationId: log.operationId,
        createdAt: ctx.now(),
      };
      nextTargets.set(op.relativeTarget, target);
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
      const ack = log.gitDeleteAcks.find(
        (a) => a.relativeTarget === op.relativeTarget
      );
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
        const linkTarget = await readlink(absolute);
        const expectedTarget =
          owned?.expectedRelativeLinkTarget ??
          ack?.expectedRelativeLinkTarget ??
          expectedLinkTarget(op.skillId);

        const identityMatch =
          (owned && sameIdentity(owned.objectIdentity, current)) ||
          (ack?.objectIdentity && sameIdentity(ack.objectIdentity, current));

        if (!(owned || ack)) {
          // No ownership proof — retain.
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

        if (!identityMatch || linkTarget !== expectedTarget) {
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

export async function commitOwnership(
  ctx: ApplyCtx,
  log: ApplyRecoveryLog
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
