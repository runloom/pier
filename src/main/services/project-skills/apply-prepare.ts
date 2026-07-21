import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ProjectSkillManifestEntry,
  ProjectSkillsManifest,
} from "../../../shared/contracts/project-skills.ts";
import { projectSkillsManifestSchema } from "../../../shared/contracts/project-skills.ts";
import {
  buildNextManifest,
  candidateSourceToManifestType,
  expectedLinkTarget,
} from "./apply-content.ts";
import {
  type ApplyCtx,
  type ApplyRecoveryLog,
  type ApplyRequest,
  computeApplyRequestDigest,
  digestBytes,
  type GitDeleteAckRecord,
  isErrno,
  ProjectSkillsApplyError,
  toIdentity,
} from "./apply-log.ts";
import type { FsObjectIdentity } from "./fs-adapter.ts";
import { resolveStableProjectIdentity } from "./identity.ts";
import { ProjectSkillsCandidateUnavailableError } from "./plan.ts";
import { REPAIR_HARD_BLOCK_CODES } from "./repair-plan-finalize.ts";

export async function prepareLog(
  ctx: ApplyCtx,
  request: ApplyRequest
): Promise<ApplyRecoveryLog> {
  const claimed = toIdentity(request.projectRef);
  const live = await resolveStableProjectIdentity(claimed.realPath);
  if (
    live.volumeId !== claimed.volumeId ||
    live.directoryIdentity !== claimed.directoryIdentity
  ) {
    throw new ProjectSkillsApplyError(
      "not-applied",
      "project identity changed",
      request.operationId
    );
  }
  const rootKey = ctx.paths.rootKeyFor(live);
  const projectRoot = live.realPath;

  const liveObserved = await ctx.getObservedRevision(projectRoot);
  if (liveObserved !== request.observedRevision) {
    throw new ProjectSkillsApplyError(
      "revision-conflict",
      "observedRevision mismatch",
      request.operationId
    );
  }

  // Recompute plan under lock.
  let plan: Awaited<ReturnType<ApplyCtx["planService"]["plan"]>>;
  try {
    plan = await ctx.planService.plan(
      request.projectRef,
      request.observedRevision,
      request.draft
    );
  } catch (error) {
    if (error instanceof ProjectSkillsCandidateUnavailableError) {
      throw new ProjectSkillsApplyError(
        error.code === "token-expired" ? "token-expired" : "not-applied",
        error.message,
        request.operationId
      );
    }
    throw error;
  }
  if (plan.planDigest !== request.planDigest) {
    throw new ProjectSkillsApplyError(
      "plan-stale",
      "planDigest mismatch",
      request.operationId
    );
  }

  // Acknowledgements: every confirmation requirement must be covered.
  const ackIds = new Set(request.acknowledgements.map((a) => a.requirementId));
  for (const req of plan.confirmationRequirements) {
    if (!ackIds.has(req.id)) {
      if (req.kind === "git-projection-delete") {
        throw new ProjectSkillsApplyError(
          "acknowledgement-required",
          `missing git delete acknowledgement for ${req.id}`,
          request.operationId
        );
      }
      if (req.kind === "content-delete") {
        throw new ProjectSkillsApplyError(
          "acknowledgement-required",
          `missing content-delete acknowledgement for ${req.id}`,
          request.operationId
        );
      }
    }
    // Content-delete acknowledgements bind to the actual tree digest the
    // user confirmed (design §4.4): the plan recomputed under lock carries
    // the CURRENT digest — if it no longer matches what was acknowledged,
    // the content changed after the confirmation.
    if (req.kind === "content-delete" && req.expectedActualTreeDigest) {
      const ack = request.acknowledgements.find(
        (a) => a.requirementId === req.id
      );
      if (ack?.expectedActualTreeDigest === undefined) {
        throw new ProjectSkillsApplyError(
          "acknowledgement-required",
          `content-delete acknowledgement for ${req.id} must bind expectedActualTreeDigest`,
          request.operationId
        );
      }
      if (ack.expectedActualTreeDigest !== req.expectedActualTreeDigest) {
        throw new ProjectSkillsApplyError(
          "content-conflict",
          `library content of ${req.skillId} changed after the delete confirmation`,
          request.operationId
        );
      }
    }
  }

  // Share the repair hard-block set plus apply-specific content blockers.
  const hardBlock =
    !plan.applicable ||
    plan.blockingIssues.some(
      (i) =>
        REPAIR_HARD_BLOCK_CODES.includes(i.code) ||
        i.code === "library-drift" ||
        i.code === "missing-source" ||
        i.code === "recovery-blocked"
    );
  if (hardBlock) {
    throw new ProjectSkillsApplyError(
      "not-applied",
      "plan has hard blocking issues",
      request.operationId
    );
  }

  // Build next manifest.
  const manifestPath = join(projectRoot, ".pier", "skills", "manifest.json");
  let currentManifest: ProjectSkillsManifest | null = null;
  let previousManifestIdentity: FsObjectIdentity | null = null;
  let previousManifestDigest: string | null = null;
  let previousManifestPresent = false;
  try {
    const raw = await readFile(manifestPath);
    previousManifestPresent = true;
    previousManifestIdentity = await ctx.fs.lstatIdentity(manifestPath);
    previousManifestDigest = digestBytes(raw);
    currentManifest = projectSkillsManifestSchema.parse(
      JSON.parse(raw.toString("utf8")) as unknown
    );
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
  }

  const importEntries = new Map<
    string,
    { contentDigest: string; source: ProjectSkillManifestEntry["source"] }
  >();
  for (const token of request.draft.importTokens ?? []) {
    const candidate = await ctx.store.readCandidate(rootKey, token);
    if (!candidate) {
      throw new ProjectSkillsApplyError(
        "not-applied",
        `unknown import token ${token}`,
        request.operationId
      );
    }
    if (candidate.expiresAt <= ctx.now()) {
      throw new ProjectSkillsApplyError(
        "token-expired",
        `import token expired: ${token}`,
        request.operationId
      );
    }
    if (candidate.state !== "AVAILABLE") {
      throw new ProjectSkillsApplyError(
        "not-applied",
        `import token unavailable: ${token}`,
        request.operationId
      );
    }
    // Content updates / drift acceptance keep the entry's original manifest
    // source type (manifest schema keeps its three source kinds; the ledger
    // sourceKind is recorded separately, design v8 §3.2).
    const existingSource = currentManifest?.skills.find(
      (s) => s.id === candidate.skillId
    )?.source;
    const isUpdateKind =
      candidate.sourceKind === "content-update" ||
      candidate.sourceKind === "drift-accepted";
    importEntries.set(candidate.skillId, {
      contentDigest: candidate.contentDigest,
      source:
        isUpdateKind && existingSource
          ? existingSource
          : { type: candidateSourceToManifestType(candidate.sourceKind) },
    });
  }

  const nextManifest = buildNextManifest(
    currentManifest,
    request.draft,
    importEntries
  );

  // Git delete acks: capture object identity before commit.
  const gitDeleteAcks: GitDeleteAckRecord[] = [];
  for (const req of plan.confirmationRequirements) {
    if (req.kind !== "git-projection-delete") continue;
    const ack = request.acknowledgements.find(
      (a) => a.requirementId === req.id
    );
    if (!ack) continue;
    const absolute = join(projectRoot, ...req.relativeTarget.split("/"));
    let objectIdentity: FsObjectIdentity | null = null;
    try {
      objectIdentity = await ctx.fs.lstatIdentity(absolute);
    } catch {
      objectIdentity = null;
    }
    gitDeleteAcks.push({
      relativeTarget: req.relativeTarget,
      skillId: req.skillId,
      nonce: ack.nonce,
      objectIdentity,
      expectedRelativeLinkTarget: expectedLinkTarget(req.skillId),
    });
  }

  const requestDigest = computeApplyRequestDigest({
    operationId: request.operationId,
    planDigest: request.planDigest,
    observedRevision: request.observedRevision,
    draft: request.draft,
    acknowledgements: request.acknowledgements,
  });

  return {
    schemaVersion: 1,
    kind: "apply",
    operationId: request.operationId,
    requestDigest,
    rollbackIntent: null,
    phase: "PREPARED",
    projectIdentity: { ...live, realPath: projectRoot },
    rootKey,
    observedRevision: request.observedRevision,
    planDigest: request.planDigest,
    draft: request.draft,
    acknowledgements: [...request.acknowledgements],
    plan,
    nextManifest,
    previousManifestPresent,
    previousManifestIdentity,
    previousManifestDigest,
    claimedTokens: [],
    publishedLibrary: [],
    gitDeleteAcks,
    targetResults: [],
    pendingIssueIds: [],
    manifestCommitted: false,
    manifestRevision: null,
    ownershipCommitted: false,
    ownershipTargets: [],
    cleanupPlans: [],
    pendingLibraryReplaces: [],
  };
}
