import { randomUUID } from "node:crypto";
import { lstat, readdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  cleanupLibrarySkillByIdentity,
  collectCleanupEntries,
  copyTreeNoFollow,
} from "./apply-content.ts";
import {
  type ApplyCtx,
  type ApplyRecoveryLog,
  digestBytes,
  isErrno,
  ProjectSkillsApplyError,
} from "./apply-log.ts";
import { writeApplyRecoveryLog } from "./apply-log-io.ts";
import { ensureProjectRelativeDir } from "./path-containment.ts";
import { computeTreeSha256V1 } from "./tree-digest.ts";

const ORPHAN_TMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Best-effort sweep of abandoned `.pier-skills-lib-*.tmp` dirs (§4.3.3). */
async function sweepOrphanLibraryTemps(
  libraryParent: string,
  now: number
): Promise<void> {
  let names: string[];
  try {
    names = await readdir(libraryParent);
  } catch {
    return;
  }
  for (const name of names) {
    if (!(name.startsWith(".pier-skills-lib-") && name.endsWith(".tmp"))) {
      continue;
    }
    const full = join(libraryParent, name);
    try {
      const st = await lstat(full);
      if (now - st.mtimeMs < ORPHAN_TMP_MAX_AGE_MS) continue;
      await rm(full, { force: true, recursive: true });
    } catch {
      // Best-effort.
    }
  }
}

export async function publishLibraryFromStaging(
  ctx: ApplyCtx,
  log: ApplyRecoveryLog
): Promise<void> {
  const projectRoot = log.projectIdentity.realPath;
  const libraryParent = join(projectRoot, ".pier", "skills", "library");
  await ensureProjectRelativeDir(projectRoot, ".pier/skills/library");
  await sweepOrphanLibraryTemps(libraryParent, ctx.now());

  for (const token of log.draft.importTokens ?? []) {
    let candidate = await ctx.store.readCandidate(log.rootKey, token);
    if (!candidate) {
      throw new ProjectSkillsApplyError(
        "not-applied",
        `import token missing: ${token}`,
        log.operationId
      );
    }
    if (candidate.state !== "CLAIMED" && candidate.state !== "AVAILABLE") {
      // Already consumed by this op is ok on recovery.
      if (
        candidate.state === "CONSUMED" &&
        candidate.operationId === log.operationId
      ) {
        continue;
      }
      throw new ProjectSkillsApplyError(
        "not-applied",
        `import token not claimable: ${token}`,
        log.operationId
      );
    }
    if (candidate.state === "AVAILABLE") {
      if (candidate.expiresAt <= ctx.now()) {
        throw new ProjectSkillsApplyError(
          "token-expired",
          `import token expired: ${token}`,
          log.operationId
        );
      }
      candidate = await ctx.store.claimCandidate(
        log.rootKey,
        token,
        log.operationId
      );
      if (!log.claimedTokens.includes(token)) {
        log.claimedTokens.push(token);
      }
    }

    const stagingTree = ctx.resolveStagingTreePath(log.rootKey, token);
    if (!stagingTree) {
      throw new ProjectSkillsApplyError(
        "not-applied",
        `staging tree missing for token ${token}`,
        log.operationId
      );
    }
    const libraryPath = join(
      projectRoot,
      ".pier",
      "skills",
      "library",
      candidate.skillId
    );
    // Already published for this op?
    if (log.publishedLibrary.some((p) => p.skillId === candidate.skillId)) {
      if (
        candidate.state === "CLAIMED" &&
        candidate.operationId === log.operationId
      ) {
        await ctx.store.consumeCandidate(log.rootKey, token, log.operationId);
      } else if (
        candidate.state !== "CONSUMED" ||
        candidate.operationId !== log.operationId
      ) {
        throw new ProjectSkillsApplyError(
          "indeterminate",
          `published import token has incompatible state: ${token}`,
          log.operationId
        );
      }
      continue;
    }
    await ensureProjectRelativeDir(projectRoot, ".pier/skills/library");
    const tempDir = join(
      dirname(libraryPath),
      `.pier-skills-lib-${process.pid}-${randomUUID()}.tmp`
    );
    await rm(tempDir, { force: true, recursive: true }).catch(() => undefined);
    await copyTreeNoFollow(stagingTree, tempDir);

    const isReplaceCandidate =
      candidate.sourceKind === "content-update" ||
      candidate.sourceKind === "drift-accepted";
    let replacementBackup:
      | {
          backupPath: string;
          entries: ApplyRecoveryLog["pendingLibraryReplaces"][number]["entries"];
        }
      | undefined;
    if (isReplaceCandidate) {
      // Replace-if-unchanged (design v8 §4.3.3), composed from existing
      // primitives: base-digest precondition → identity cleanup of the old
      // tree → no-replace publish of the new tree. Never rm -rf.
      if (
        candidate.baseSkillId !== undefined &&
        candidate.baseSkillId !== candidate.skillId
      ) {
        await rm(tempDir, { force: true, recursive: true }).catch(
          () => undefined
        );
        throw new ProjectSkillsApplyError(
          "not-applied",
          `content-update base skill mismatch: ${candidate.skillId}`,
          log.operationId
        );
      }
      let existingDigest: string | null = null;
      try {
        await lstat(libraryPath);
        existingDigest = await computeTreeSha256V1(libraryPath);
      } catch (error) {
        if (!isErrno(error, "ENOENT")) {
          await rm(tempDir, { force: true, recursive: true }).catch(
            () => undefined
          );
          throw error;
        }
      }
      let pending = log.pendingLibraryReplaces.find(
        (p) => p.skillId === candidate.skillId
      );
      if (pending) {
        let backupPresent = false;
        try {
          await lstat(pending.backupPath);
          backupPresent = true;
        } catch (error) {
          if (!isErrno(error, "ENOENT")) throw error;
        }
        if (existingDigest === candidate.contentDigest && backupPresent) {
          const entries = await collectCleanupEntries(libraryPath, ctx.fs);
          const rootIdentity = await ctx.fs.lstatIdentity(libraryPath);
          log.publishedLibrary.push({
            backupPath: pending.backupPath,
            replacedEntries: pending.entries,
            skillId: candidate.skillId,
            libraryPath,
            rootIdentity,
            entries,
            fromImportToken: token,
          });
          log.pendingLibraryReplaces = log.pendingLibraryReplaces.filter(
            (p) => p.skillId !== candidate.skillId
          );
          await writeApplyRecoveryLog(
            ctx.paths.operationsDir(log.rootKey),
            log
          );
          await ctx.hooks?.afterLibraryPublishLogged?.({
            operationId: log.operationId,
            rootKey: log.rootKey,
            phase: log.phase,
            projectRoot: log.projectIdentity.realPath,
          });
          await ctx.store.consumeCandidate(log.rootKey, token, log.operationId);
          await rm(tempDir, { force: true, recursive: true }).catch(
            () => undefined
          );
          continue;
        }
        if (existingDigest === null && !backupPresent) {
          throw new ProjectSkillsApplyError(
            "indeterminate",
            `library replacement lost both active and backup trees for ${candidate.skillId}`,
            log.operationId
          );
        }
        replacementBackup = {
          backupPath: pending.backupPath,
          entries: pending.entries,
        };
      }
      // Absent target is allowed (idempotent recovery after cleanup); a
      // present target must still match the edit base — never stack an
      // update after concurrent library change (digest mismatch).
      if (
        existingDigest !== null &&
        candidate.baseContentDigest !== undefined &&
        existingDigest !== candidate.baseContentDigest
      ) {
        await rm(tempDir, { force: true, recursive: true }).catch(
          () => undefined
        );
        throw new ProjectSkillsApplyError(
          "not-applied",
          `content-conflict: library changed since edit base for ${candidate.skillId}`,
          log.operationId
        );
      }
      if (existingDigest !== null) {
        const oldEntries = await collectCleanupEntries(libraryPath, ctx.fs);
        if (!pending) {
          pending = {
            skillId: candidate.skillId,
            libraryPath,
            tempDir,
            backupPath: join(
              dirname(libraryPath),
              `.pier-skills-backup-${log.operationId}-${randomUUID()}`
            ),
            entries: oldEntries,
            replacementDigest: candidate.contentDigest,
          };
          log.pendingLibraryReplaces.push(pending);
          await writeApplyRecoveryLog(
            ctx.paths.operationsDir(log.rootKey),
            log
          );
        }
        try {
          await lstat(pending.backupPath);
        } catch (error) {
          if (!isErrno(error, "ENOENT")) throw error;
          await rename(libraryPath, pending.backupPath);
          await ctx.fs
            .syncDirectory(dirname(libraryPath))
            .catch(() => undefined);
        }
        replacementBackup = {
          backupPath: pending.backupPath,
          entries: pending.entries,
        };
      }
    }

    // publish no-replace via rename exclusive semantics
    try {
      await lstat(libraryPath);
      // target exists — conflict
      await rm(tempDir, { force: true, recursive: true }).catch(
        () => undefined
      );
      throw new ProjectSkillsApplyError(
        "not-applied",
        `library path already exists: ${candidate.skillId}`,
        log.operationId
      );
    } catch (error) {
      if (!isErrno(error, "ENOENT")) {
        if (error instanceof ProjectSkillsApplyError) throw error;
        throw error;
      }
    }
    await rename(tempDir, libraryPath);
    const entries = await collectCleanupEntries(libraryPath, ctx.fs);
    const rootIdentity = await ctx.fs.lstatIdentity(libraryPath);
    log.publishedLibrary.push({
      ...(replacementBackup
        ? {
            backupPath: replacementBackup.backupPath,
            replacedEntries: replacementBackup.entries,
          }
        : {}),
      skillId: candidate.skillId,
      libraryPath,
      rootIdentity,
      entries,
      fromImportToken: token,
    });
    log.pendingLibraryReplaces = log.pendingLibraryReplaces.filter(
      (p) => p.skillId !== candidate.skillId
    );
    await writeApplyRecoveryLog(ctx.paths.operationsDir(log.rootKey), log);
    await ctx.hooks?.afterLibraryPublishLogged?.({
      operationId: log.operationId,
      rootKey: log.rootKey,
      phase: log.phase,
      projectRoot: log.projectIdentity.realPath,
    });
    await ctx.store.consumeCandidate(log.rootKey, token, log.operationId);
    // Staging tree cleanup waits until FINALIZED so recovery can still
    // identify and reclaim the consumed candidate.
    await ctx.fs.syncDirectory(dirname(libraryPath)).catch(() => undefined);
  }
}

export async function cleanupCommittedReplacementBackups(
  ctx: ApplyCtx,
  log: ApplyRecoveryLog
): Promise<void> {
  let changed = false;
  for (const published of log.publishedLibrary) {
    if (!published.backupPath) continue;
    await rm(published.backupPath, { force: true, recursive: true });
    changed = true;
  }
  if (changed) {
    log.publishedLibrary = log.publishedLibrary.map((published) =>
      published.backupPath
        ? {
            skillId: published.skillId,
            libraryPath: published.libraryPath,
            rootIdentity: published.rootIdentity,
            entries: published.entries,
            ...(published.fromImportToken
              ? { fromImportToken: published.fromImportToken }
              : {}),
          }
        : published
    );
    await writeApplyRecoveryLog(ctx.paths.operationsDir(log.rootKey), log);
  }
}

export async function commitManifest(
  ctx: ApplyCtx,
  log: ApplyRecoveryLog
): Promise<void> {
  const projectRoot = log.projectIdentity.realPath;
  const manifestPath = join(projectRoot, ".pier", "skills", "manifest.json");
  await ensureProjectRelativeDir(projectRoot, ".pier/skills");
  const bytes = Buffer.from(
    `${JSON.stringify(log.nextManifest, null, 2)}\n`,
    "utf8"
  );
  const digest = digestBytes(bytes);
  const expected =
    log.previousManifestPresent && log.previousManifestIdentity
      ? {
          kind: "present" as const,
          identity: log.previousManifestIdentity,
          digest: log.previousManifestDigest ?? digest,
        }
      : { kind: "absent" as const };

  const publish = await ctx.fs.publishFileReplaceIfUnchanged({
    path: manifestPath,
    expected,
    bytes,
    digestOf: digestBytes,
  });

  if (publish.status === "conflict") {
    const currentDigest = await readFile(manifestPath)
      .then((current) => digestBytes(current))
      .catch(() => null);
    if (currentDigest !== digest) {
      throw new ProjectSkillsApplyError(
        "not-applied",
        `manifest publish conflict: ${publish.reason}`,
        log.operationId
      );
    }
  }
  if (publish.status === "indeterminate") {
    throw new ProjectSkillsApplyError(
      "indeterminate",
      `manifest publish indeterminate: ${publish.reason}`,
      log.operationId
    );
  }

  log.manifestCommitted = true;
  log.manifestRevision = digest;
  await ctx.fs.syncDirectory(dirname(manifestPath)).catch(() => undefined);
  // Persist the commit witness before phase advancement. Recovery can safely
  // retain replacement backups whenever the manifest CAS has taken effect.
  await writeApplyRecoveryLog(ctx.paths.operationsDir(log.rootKey), log);
}

export async function runCleanup(
  ctx: ApplyCtx,
  log: ApplyRecoveryLog
): Promise<void> {
  for (const plan of log.cleanupPlans) {
    const result = await cleanupLibrarySkillByIdentity({
      libraryDir: plan.libraryDir,
      expectedEntries: plan.entries,
      fs: ctx.fs,
    });
    if (result.status === "cleanup-pending") {
      const issueId = `cleanup-pending:${plan.skillId}`;
      if (!log.pendingIssueIds.includes(issueId)) {
        log.pendingIssueIds.push(issueId);
      }
    }
  }
}

export async function buildCleanupPlans(
  ctx: ApplyCtx,
  log: ApplyRecoveryLog
): Promise<void> {
  if (log.cleanupPlans.length > 0) return;
  const projectRoot = log.projectIdentity.realPath;
  for (const skillId of log.draft.deleteSkillIds ?? []) {
    const libraryDir = join(projectRoot, ".pier", "skills", "library", skillId);
    try {
      await lstat(libraryDir);
    } catch (error) {
      if (isErrno(error, "ENOENT")) continue;
      throw error;
    }
    const entries = await collectCleanupEntries(libraryDir, ctx.fs);
    log.cleanupPlans.push({ skillId, libraryDir, entries });
  }
}
