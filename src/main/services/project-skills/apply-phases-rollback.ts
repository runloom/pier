import { rename } from "node:fs/promises";
import { dirname } from "node:path";
import {
  cleanupLibrarySkillByIdentity,
  collectCleanupEntries,
} from "./apply-content.ts";
import {
  type ApplyCtx,
  type ApplyHookContext,
  type ApplyRecoveryLog,
  ProjectSkillsApplyError,
  sameIdentity,
} from "./apply-log.ts";
import { writeApplyRecoveryLog } from "./apply-log-io.ts";
import { computeTreeSha256V1 } from "./tree-digest.ts";

function hookContext(log: ApplyRecoveryLog): ApplyHookContext {
  return {
    operationId: log.operationId,
    rootKey: log.rootKey,
    phase: log.phase,
    projectRoot: log.projectIdentity.realPath,
  };
}

export async function treeMatchesExpectedEntries(
  ctx: ApplyCtx,
  path: string,
  expected: ApplyRecoveryLog["publishedLibrary"][number]["entries"]
): Promise<boolean> {
  const actual = await collectCleanupEntries(path, ctx.fs).catch(() => null);
  if (!actual || actual.length !== expected.length) return false;
  const actualByPath = new Map(
    actual.map((entry) => [entry.relativePath, entry] as const)
  );
  return expected.every((entry) => {
    const match = actualByPath.get(entry.relativePath);
    return (
      match?.kind === entry.kind && sameIdentity(match.identity, entry.identity)
    );
  });
}

async function persistRollbackProgress(
  ctx: ApplyCtx,
  log: ApplyRecoveryLog
): Promise<void> {
  await writeApplyRecoveryLog(ctx.paths.operationsDir(log.rootKey), log);
  await ctx.fs
    .syncDirectory(ctx.paths.operationsDir(log.rootKey))
    .catch(() => undefined);
}

export async function rollbackPreCommit(
  ctx: ApplyCtx,
  log: ApplyRecoveryLog
): Promise<void> {
  // Roll back library publishes whose identity still matches the log. A
  // replacement backup is retained until the manifest commit is durable.
  for (const published of [...log.publishedLibrary].reverse()) {
    const current = await ctx.fs
      .lstatIdentity(published.libraryPath)
      .catch(() => null);
    const backup =
      published.backupPath === undefined
        ? null
        : await ctx.fs.lstatIdentity(published.backupPath).catch(() => null);
    if (published.backupPath && !backup) {
      const alreadyRestored =
        current !== null &&
        published.replacedEntries !== undefined &&
        (await treeMatchesExpectedEntries(
          ctx,
          published.libraryPath,
          published.replacedEntries
        ));
      if (!alreadyRestored) {
        throw new ProjectSkillsApplyError(
          "indeterminate",
          `replacement backup missing for ${published.skillId}`,
          log.operationId
        );
      }
      log.publishedLibrary = log.publishedLibrary.filter(
        (entry) => entry !== published
      );
      await persistRollbackProgress(ctx, log);
      continue;
    }
    if (current && !sameIdentity(current, published.rootIdentity)) {
      throw new ProjectSkillsApplyError(
        "indeterminate",
        `cannot roll back externally changed library tree ${published.skillId}`,
        log.operationId
      );
    }
    if (current) {
      const cleanup = await cleanupLibrarySkillByIdentity({
        libraryDir: published.libraryPath,
        expectedEntries: published.entries,
        fs: ctx.fs,
      });
      if (cleanup.status !== "removed") {
        throw new ProjectSkillsApplyError(
          "indeterminate",
          `cannot remove published library tree ${published.skillId}: ${cleanup.reason}`,
          log.operationId
        );
      }
    }
    if (published.backupPath) {
      await ctx.fs
        .lstatIdentity(published.libraryPath)
        .then(() => {
          throw new ProjectSkillsApplyError(
            "indeterminate",
            `replacement target remained during rollback for ${published.skillId}`,
            log.operationId
          );
        })
        .catch((error: unknown) => {
          if (error instanceof ProjectSkillsApplyError) throw error;
        });
      await rename(published.backupPath, published.libraryPath);
      await ctx.fs
        .syncDirectory(dirname(published.libraryPath))
        .catch(() => undefined);
      await ctx.hooks?.afterReplacementRestored?.(hookContext(log));
    }
    log.publishedLibrary = log.publishedLibrary.filter(
      (entry) => entry !== published
    );
    await persistRollbackProgress(ctx, log);
  }
  for (const pending of [...log.pendingLibraryReplaces].reverse()) {
    const backup = await ctx.fs
      .lstatIdentity(pending.backupPath)
      .catch(() => null);
    const current = await ctx.fs
      .lstatIdentity(pending.libraryPath)
      .catch(() => null);
    if (!backup) {
      if (!current) {
        throw new ProjectSkillsApplyError(
          "indeterminate",
          `replacement lost both active and backup trees for ${pending.skillId}`,
          log.operationId
        );
      }
      if (
        !(await treeMatchesExpectedEntries(
          ctx,
          pending.libraryPath,
          pending.entries
        ))
      ) {
        throw new ProjectSkillsApplyError(
          "indeterminate",
          `cannot verify restored replacement tree ${pending.skillId}`,
          log.operationId
        );
      }
      log.pendingLibraryReplaces = log.pendingLibraryReplaces.filter(
        (entry) => entry !== pending
      );
      await persistRollbackProgress(ctx, log);
      continue;
    }
    if (current) {
      const digest = await computeTreeSha256V1(pending.libraryPath).catch(
        () => null
      );
      if (digest !== pending.replacementDigest) {
        throw new ProjectSkillsApplyError(
          "indeterminate",
          `cannot roll back changed replacement tree ${pending.skillId}`,
          log.operationId
        );
      }
      const entries = await collectCleanupEntries(pending.libraryPath, ctx.fs);
      const cleanup = await cleanupLibrarySkillByIdentity({
        libraryDir: pending.libraryPath,
        expectedEntries: entries,
        fs: ctx.fs,
      });
      if (cleanup.status !== "removed") {
        throw new ProjectSkillsApplyError(
          "indeterminate",
          `cannot remove pending replacement ${pending.skillId}: ${cleanup.reason}`,
          log.operationId
        );
      }
    }
    await rename(pending.backupPath, pending.libraryPath);
    await ctx.fs
      .syncDirectory(dirname(pending.libraryPath))
      .catch(() => undefined);
    await ctx.hooks?.afterReplacementRestored?.(hookContext(log));
    log.pendingLibraryReplaces = log.pendingLibraryReplaces.filter(
      (entry) => entry !== pending
    );
    await persistRollbackProgress(ctx, log);
  }
  for (const token of log.claimedTokens) {
    try {
      await ctx.store.releaseCandidate(log.rootKey, token, log.operationId);
    } catch {
      // ignore
    }
  }
}
