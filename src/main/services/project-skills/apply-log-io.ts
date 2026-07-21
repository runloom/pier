import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ProjectSkillsAcknowledgement,
  ProjectSkillsDraft,
  ProjectSkillsManifest,
} from "../../../shared/contracts/project-skills.ts";
import {
  type ApplyRecoveryLog,
  type ApplyTransactionPhase,
  type CleanupEntryExpectation,
  type GitDeleteAckRecord,
  identityFromJson,
  identityToJson,
  isErrno,
  type LibraryPublishRecord,
  type TargetOpResult,
  writeJsonAtomic,
} from "./apply-log.ts";
import type { StableProjectIdentity } from "./identity.ts";
import type { ProjectSkillsPlan } from "./plan.ts";
import type { OwnershipTarget } from "./store.ts";

function serializeRecoveryLog(log: ApplyRecoveryLog): unknown {
  return {
    ...log,
    previousManifestIdentity: log.previousManifestIdentity
      ? identityToJson(log.previousManifestIdentity)
      : null,
    publishedLibrary: log.publishedLibrary.map((p) => ({
      ...p,
      rootIdentity: identityToJson(p.rootIdentity),
      entries: p.entries.map((e) => ({
        ...e,
        identity: identityToJson(e.identity),
      })),
      replacedEntries: p.replacedEntries?.map((e) => ({
        ...e,
        identity: identityToJson(e.identity),
      })),
    })),
    gitDeleteAcks: log.gitDeleteAcks.map((g) => ({
      ...g,
      objectIdentity: g.objectIdentity
        ? identityToJson(g.objectIdentity)
        : null,
    })),
    ownershipTargets: log.ownershipTargets.map((t) => ({
      ...t,
      objectIdentity: identityToJson(t.objectIdentity),
    })),
    cleanupPlans: log.cleanupPlans.map((c) => ({
      ...c,
      entries: c.entries.map((e) => ({
        ...e,
        identity: identityToJson(e.identity),
      })),
    })),
    pendingLibraryReplaces: (log.pendingLibraryReplaces ?? []).map((c) => ({
      ...c,
      entries: c.entries.map((e) => ({
        ...e,
        identity: identityToJson(e.identity),
      })),
    })),
  };
}

function parseRecoveryLog(value: unknown): ApplyRecoveryLog | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== 1 || v.kind !== "apply") return null;
  if (typeof v.operationId !== "string") return null;
  if (typeof v.requestDigest !== "string") return null;
  if (typeof v.phase !== "string") return null;
  if (typeof v.rootKey !== "string") return null;

  const prevId =
    v.previousManifestIdentity === null ||
    v.previousManifestIdentity === undefined
      ? null
      : identityFromJson(v.previousManifestIdentity);
  let rollbackIntent: ApplyRecoveryLog["rollbackIntent"] = null;
  if (v.rollbackIntent !== undefined && v.rollbackIntent !== null) {
    if (
      typeof v.rollbackIntent !== "object" ||
      !("reason" in v.rollbackIntent) ||
      typeof v.rollbackIntent.reason !== "string" ||
      !("startedAt" in v.rollbackIntent) ||
      typeof v.rollbackIntent.startedAt !== "number"
    ) {
      return null;
    }
    rollbackIntent = {
      reason: v.rollbackIntent.reason,
      startedAt: v.rollbackIntent.startedAt,
    };
  }

  const publishedLibraryRaw = Array.isArray(v.publishedLibrary)
    ? v.publishedLibrary
    : [];
  const publishedLibrary: LibraryPublishRecord[] = [];
  for (const item of publishedLibraryRaw) {
    if (typeof item !== "object" || item === null) return null;
    const p = item as Record<string, unknown>;
    const rootIdentity = identityFromJson(p.rootIdentity);
    if (
      !rootIdentity ||
      typeof p.skillId !== "string" ||
      typeof p.libraryPath !== "string"
    ) {
      return null;
    }
    const entriesRaw = Array.isArray(p.entries) ? p.entries : [];
    const entries: CleanupEntryExpectation[] = [];
    for (const e of entriesRaw) {
      if (typeof e !== "object" || e === null) return null;
      const er = e as Record<string, unknown>;
      const id = identityFromJson(er.identity);
      if (
        !id ||
        typeof er.relativePath !== "string" ||
        (er.kind !== "file" && er.kind !== "directory")
      ) {
        return null;
      }
      entries.push({
        relativePath: er.relativePath,
        kind: er.kind,
        identity: id,
      });
    }
    const replacedEntriesRaw = Array.isArray(p.replacedEntries)
      ? p.replacedEntries
      : [];
    const replacedEntries: CleanupEntryExpectation[] = [];
    for (const e of replacedEntriesRaw) {
      if (typeof e !== "object" || e === null) return null;
      const er = e as Record<string, unknown>;
      const id = identityFromJson(er.identity);
      if (
        !id ||
        typeof er.relativePath !== "string" ||
        (er.kind !== "file" && er.kind !== "directory")
      ) {
        return null;
      }
      replacedEntries.push({
        relativePath: er.relativePath,
        kind: er.kind,
        identity: id,
      });
    }
    publishedLibrary.push({
      skillId: p.skillId,
      libraryPath: p.libraryPath,
      rootIdentity,
      entries,
      ...(typeof p.backupPath === "string" ? { backupPath: p.backupPath } : {}),
      ...(replacedEntries.length > 0 ? { replacedEntries } : {}),
      ...(typeof p.fromImportToken === "string"
        ? { fromImportToken: p.fromImportToken }
        : {}),
    });
  }

  const cleanupPlansRaw = Array.isArray(v.cleanupPlans) ? v.cleanupPlans : [];
  const cleanupPlans: ApplyRecoveryLog["cleanupPlans"] = [];
  for (const item of cleanupPlansRaw) {
    if (typeof item !== "object" || item === null) return null;
    const c = item as Record<string, unknown>;
    if (typeof c.skillId !== "string" || typeof c.libraryDir !== "string") {
      return null;
    }
    const entriesRaw = Array.isArray(c.entries) ? c.entries : [];
    const entries: CleanupEntryExpectation[] = [];
    for (const e of entriesRaw) {
      if (typeof e !== "object" || e === null) return null;
      const er = e as Record<string, unknown>;
      const id = identityFromJson(er.identity);
      if (
        !id ||
        typeof er.relativePath !== "string" ||
        (er.kind !== "file" && er.kind !== "directory")
      ) {
        return null;
      }
      entries.push({
        relativePath: er.relativePath,
        kind: er.kind,
        identity: id,
      });
    }
    cleanupPlans.push({
      skillId: c.skillId,
      libraryDir: c.libraryDir,
      entries,
    });
  }

  const pendingReplacesRaw = Array.isArray(v.pendingLibraryReplaces)
    ? v.pendingLibraryReplaces
    : [];
  const pendingLibraryReplaces: ApplyRecoveryLog["pendingLibraryReplaces"] = [];
  for (const item of pendingReplacesRaw) {
    if (typeof item !== "object" || item === null) return null;
    const c = item as Record<string, unknown>;
    if (
      typeof c.skillId !== "string" ||
      typeof c.libraryPath !== "string" ||
      typeof c.tempDir !== "string" ||
      typeof c.backupPath !== "string" ||
      typeof c.replacementDigest !== "string"
    ) {
      return null;
    }
    const entriesRaw = Array.isArray(c.entries) ? c.entries : [];
    const entries: CleanupEntryExpectation[] = [];
    for (const e of entriesRaw) {
      if (typeof e !== "object" || e === null) return null;
      const er = e as Record<string, unknown>;
      const id = identityFromJson(er.identity);
      if (
        !id ||
        typeof er.relativePath !== "string" ||
        (er.kind !== "file" && er.kind !== "directory")
      ) {
        return null;
      }
      entries.push({
        relativePath: er.relativePath,
        kind: er.kind,
        identity: id,
      });
    }
    pendingLibraryReplaces.push({
      skillId: c.skillId,
      libraryPath: c.libraryPath,
      tempDir: c.tempDir,
      backupPath: c.backupPath,
      replacementDigest: c.replacementDigest,
      entries,
    });
  }

  const ownershipTargetsRaw = Array.isArray(v.ownershipTargets)
    ? v.ownershipTargets
    : [];
  const ownershipTargets: OwnershipTarget[] = [];
  for (const item of ownershipTargetsRaw) {
    if (typeof item !== "object" || item === null) return null;
    const t = item as Record<string, unknown>;
    const objectIdentity = identityFromJson(t.objectIdentity);
    if (
      !objectIdentity ||
      typeof t.relativePath !== "string" ||
      typeof t.skillId !== "string" ||
      typeof t.expectedRelativeLinkTarget !== "string" ||
      typeof t.createdByOperationId !== "string" ||
      typeof t.createdAt !== "number"
    ) {
      return null;
    }
    ownershipTargets.push({
      relativePath: t.relativePath,
      skillId: t.skillId,
      expectedRelativeLinkTarget: t.expectedRelativeLinkTarget,
      objectIdentity,
      createdByOperationId: t.createdByOperationId,
      createdAt: t.createdAt,
    });
  }

  const gitDeleteAcksRaw = Array.isArray(v.gitDeleteAcks)
    ? v.gitDeleteAcks
    : [];
  const gitDeleteAcks: GitDeleteAckRecord[] = [];
  for (const item of gitDeleteAcksRaw) {
    if (typeof item !== "object" || item === null) return null;
    const g = item as Record<string, unknown>;
    if (
      typeof g.relativeTarget !== "string" ||
      typeof g.skillId !== "string" ||
      typeof g.nonce !== "string" ||
      typeof g.expectedRelativeLinkTarget !== "string"
    ) {
      return null;
    }
    gitDeleteAcks.push({
      relativeTarget: g.relativeTarget,
      skillId: g.skillId,
      nonce: g.nonce,
      expectedRelativeLinkTarget: g.expectedRelativeLinkTarget,
      objectIdentity:
        g.objectIdentity === null || g.objectIdentity === undefined
          ? null
          : identityFromJson(g.objectIdentity),
    });
  }

  const phase =
    v.phase === "APPROVALS_COMMITTED"
      ? "MANIFEST_COMMITTED"
      : (v.phase as ApplyTransactionPhase);
  const log: ApplyRecoveryLog = {
    schemaVersion: 1,
    kind: "apply",
    operationId: v.operationId as string,
    requestDigest: v.requestDigest as string,
    rollbackIntent,
    phase,
    projectIdentity: v.projectIdentity as StableProjectIdentity,
    rootKey: v.rootKey as string,
    observedRevision: String(v.observedRevision),
    planDigest: String(v.planDigest),
    draft: v.draft as ProjectSkillsDraft,
    acknowledgements: (v.acknowledgements ??
      []) as ProjectSkillsAcknowledgement[],
    plan: v.plan as ProjectSkillsPlan,
    nextManifest: v.nextManifest as ProjectSkillsManifest,
    previousManifestPresent: v.previousManifestPresent === true,
    previousManifestIdentity: prevId,
    previousManifestDigest:
      typeof v.previousManifestDigest === "string"
        ? v.previousManifestDigest
        : null,
    claimedTokens: Array.isArray(v.claimedTokens)
      ? (v.claimedTokens as string[])
      : [],
    publishedLibrary,
    gitDeleteAcks,
    targetResults: Array.isArray(v.targetResults)
      ? (v.targetResults as TargetOpResult[])
      : [],
    pendingIssueIds: Array.isArray(v.pendingIssueIds)
      ? (v.pendingIssueIds as string[])
      : [],
    manifestCommitted: v.manifestCommitted === true,
    manifestRevision:
      typeof v.manifestRevision === "string" ? v.manifestRevision : null,
    ownershipCommitted: v.ownershipCommitted === true,
    ownershipTargets,
    cleanupPlans,
    pendingLibraryReplaces,
  };
  if (v.finalizedResult !== undefined && v.finalizedResult !== null) {
    log.finalizedResult = v.finalizedResult as NonNullable<
      ApplyRecoveryLog["finalizedResult"]
    >;
  }
  return log;
}

export function recoveryLogPath(
  operationsDir: string,
  operationId: string
): string {
  return join(operationsDir, `${operationId}.recovery.json`);
}

export async function readApplyRecoveryLog(
  operationsDir: string,
  operationId: string
): Promise<ApplyRecoveryLog | null> {
  try {
    const raw = await readFile(
      recoveryLogPath(operationsDir, operationId),
      "utf8"
    );
    return parseRecoveryLog(JSON.parse(raw) as unknown);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return null;
    throw error;
  }
}

export async function writeApplyRecoveryLog(
  operationsDir: string,
  log: ApplyRecoveryLog
): Promise<void> {
  await writeJsonAtomic(
    recoveryLogPath(operationsDir, log.operationId),
    serializeRecoveryLog(log)
  );
}
