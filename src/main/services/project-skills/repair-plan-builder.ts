import { readlink } from "node:fs/promises";
import { join } from "node:path";
import {
  type ProjectRootRef as ContractProjectRootRef,
  listPierProjectionRoots,
} from "../../../shared/contracts/project-skills.ts";
import { buildProjectSkillsIssue, type ProjectSkillsIssue } from "./health.ts";
import {
  type ProjectRootRef as MainProjectRootRef,
  resolveStableProjectIdentity,
  type StableProjectIdentity,
  toContractProjectRootRef,
} from "./identity.ts";
import {
  classifyTargetShape,
  expectedLinkTargetFor,
  inspectLibraryContentState,
} from "./library-state.ts";
import type {
  PlanConfirmationRequirement,
  PlanTargetOperation,
} from "./plan.ts";
import {
  isErrno,
  type ProjectSkillsRepairPlan,
  type RepairContext,
  readManifestState,
  sameIdentity,
  toIdentity,
} from "./repair-log.ts";
import { finalizePlan } from "./repair-plan-finalize.ts";
import { type OwnershipRecord, ProjectSkillsLedgerCorrupt } from "./store.ts";

// Projection targets come from listPierProjectionRoots(manifest.delivery);
// repair reconciles the same delivery-selected set as plan.

export async function resolveLive(
  ctx: RepairContext,
  projectRef: ContractProjectRootRef | MainProjectRootRef
): Promise<{
  claimed: StableProjectIdentity;
  live: StableProjectIdentity;
  rootKey: string;
  projectRef: ContractProjectRootRef;
}> {
  const claimed = toIdentity(projectRef);
  const live = await resolveStableProjectIdentity(claimed.realPath);
  return {
    claimed,
    live,
    rootKey: ctx.paths.rootKeyFor(live),
    projectRef: toContractProjectRootRef(live),
  };
}

export function expectedLinkTarget(
  skillId: string,
  deliveryRoot: string
): string {
  return expectedLinkTargetFor(skillId, deliveryRoot);
}

export interface DesiredSystemProjection {
  expectedRelativeLinkTarget: string;
  relativeTarget: string;
  skillId: string;
}

export async function buildRepairPlan(
  ctx: RepairContext,
  projectRefInput: ContractProjectRootRef | MainProjectRootRef,
  observedRevision: string,
  continuationOf?: string,
  opts?: {
    safeOnly?: boolean;
    desiredSystemProjections?: readonly DesiredSystemProjection[];
  }
): Promise<ProjectSkillsRepairPlan> {
  const checkedAt = ctx.now();
  const { claimed, live, rootKey } = await resolveLive(ctx, projectRefInput);
  const blockingIssues: ProjectSkillsIssue[] = [];
  const confirmationRequirements: PlanConfirmationRequirement[] = [];
  const targetOperations: PlanTargetOperation[] = [];

  if (
    live.volumeId !== claimed.volumeId ||
    live.directoryIdentity !== claimed.directoryIdentity
  ) {
    blockingIssues.push(
      buildProjectSkillsIssue({
        code: "project-identity-changed",
        scope: "project",
        checkedAt,
      })
    );
    return finalizePlan({
      observedRevision,
      ...(continuationOf === undefined ? {} : { continuationOf }),
      targetOperations,
      confirmationRequirements,
      blockingIssues,
    });
  }

  let ownership: OwnershipRecord | null = null;
  try {
    ownership = await ctx.store.readOwnership(rootKey);
  } catch (error) {
    if (error instanceof ProjectSkillsLedgerCorrupt) {
      blockingIssues.push(
        buildProjectSkillsIssue({
          code: error.code,
          scope: "project",
          checkedAt,
          evidence: { message: error.message },
        })
      );
    } else {
      throw error;
    }
  }
  if (blockingIssues.some((i) => i.code.includes("corrupt"))) {
    return finalizePlan({
      observedRevision,
      ...(continuationOf === undefined ? {} : { continuationOf }),
      targetOperations,
      confirmationRequirements,
      blockingIssues,
    });
  }

  const manifestState = await readManifestState(live.realPath);
  const desiredTargets = new Map<
    string,
    { skillId: string; expectedRelativeLinkTarget: string }
  >(
    (opts?.desiredSystemProjections ?? []).map((projection) => [
      projection.relativeTarget,
      {
        skillId: projection.skillId,
        expectedRelativeLinkTarget: projection.expectedRelativeLinkTarget,
      },
    ])
  );

  // Three-state manifest handling (design §5.1).
  if (manifestState.status === "invalid") {
    blockingIssues.push(
      buildProjectSkillsIssue({
        code: "invalid-skill",
        scope: "project",
        checkedAt,
        evidence: { reason: manifestState.reason },
      })
    );
    return finalizePlan({
      observedRevision,
      ...(continuationOf === undefined ? {} : { continuationOf }),
      targetOperations,
      confirmationRequirements,
      blockingIssues,
    });
  }

  if (manifestState.status === "absent") {
    const hasLedger = (ownership?.targets.length ?? 0) > 0;
    if (!hasLedger && desiredTargets.size === 0) {
      // No manifest + no ledger → no-op.
      return finalizePlan({
        observedRevision,
        ...(continuationOf === undefined ? {} : { continuationOf }),
        targetOperations,
        confirmationRequirements,
        blockingIssues,
      });
    }
    if (desiredTargets.size === 0) {
      // Residual ledger: safe-delete owned projections only.
      for (const target of ownership?.targets ?? []) {
        const gitState = await ctx.inspectGitState(
          target.relativePath,
          live.realPath
        );
        if (gitState === "tracked") {
          confirmationRequirements.push({
            id: `confirm:git-delete:${target.relativePath}`,
            kind: "git-projection-delete",
            relativeTarget: target.relativePath,
            skillId: target.skillId,
            gitState,
          });
          if (!opts?.safeOnly) {
            targetOperations.push({
              kind: "delete-symlink",
              relativeTarget: target.relativePath,
              skillId: target.skillId,
            });
          }
          continue;
        }
        targetOperations.push({
          kind: "delete-symlink",
          relativeTarget: target.relativePath,
          skillId: target.skillId,
        });
      }
      return finalizePlan({
        observedRevision,
        ...(continuationOf === undefined ? {} : { continuationOf }),
        targetOperations,
        confirmationRequirements,
        blockingIssues,
      });
    }
  }

  // A project may have machine-local system skills without a user manifest.
  const manifest =
    manifestState.status === "present"
      ? manifestState.manifest
      : {
          version: 1 as const,
          delivery: { agents: false, claude: false },
          skills: [],
        };
  const ownedByPath = new Map(
    (ownership?.targets ?? []).map((t) => [t.relativePath, t] as const)
  );
  for (const entry of manifest.skills) {
    if (!entry.enabled) continue;

    const roots = listPierProjectionRoots(manifest.delivery);

    // The manifest digest is the expected content, but the library tree may
    // have changed underneath. Drifted or
    // missing content is never (re)projected; while a live projection still
    // exposes it, the issue blocks managed launches. Once the projection is
    // gone the skill simply stops loading — launches proceed.
    const contentState = await inspectLibraryContentState(
      live.realPath,
      entry.id,
      entry.contentDigest
    );
    if (contentState !== "ok") {
      let projectionLive = false;
      for (const root of roots) {
        const relativeTarget = `${root}/${entry.id}`;
        if (!ownedByPath.has(relativeTarget)) continue;
        const shape = await classifyTargetShape(
          join(live.realPath, ...relativeTarget.split("/")),
          expectedLinkTarget(entry.id, root)
        );
        if (shape === "pier-symlink") {
          projectionLive = true;
        }
      }
      if (projectionLive) {
        blockingIssues.push(
          buildProjectSkillsIssue({
            code:
              contentState === "missing" ? "missing-source" : "library-drift",
            scope: "skill",
            skillId: entry.id,
            checkedAt,
            evidence: { expectedContentDigest: entry.contentDigest },
          })
        );
      }
      // Not desired: the owned-but-undesired sweep below schedules teardown
      // (tracked targets still require explicit confirmation).
      continue;
    }

    for (const root of roots) {
      const relativeTarget = `${root}/${entry.id}`;
      desiredTargets.set(relativeTarget, {
        skillId: entry.id,
        expectedRelativeLinkTarget: expectedLinkTarget(entry.id, root),
      });
    }
  }

  // Create / verify desired projections.
  for (const [relativeTarget, desired] of [...desiredTargets.entries()].sort(
    (a, b) => a[0].localeCompare(b[0])
  )) {
    const absolute = join(live.realPath, ...relativeTarget.split("/"));
    const owned = ownedByPath.get(relativeTarget);
    try {
      const existing = await ctx.fs.lstatIdentity(absolute);
      if (existing.isSymbolicLink) {
        const linkTarget = await readlink(absolute);
        if (
          linkTarget === desired.expectedRelativeLinkTarget &&
          owned &&
          sameIdentity(owned.objectIdentity, existing)
        ) {
          targetOperations.push({
            kind: "noop",
            relativeTarget,
            skillId: desired.skillId,
          });
          continue;
        }
        if (linkTarget === desired.expectedRelativeLinkTarget && !owned) {
          // Correct link but not in our ledger — unmanaged, do not adopt.
          blockingIssues.push(
            buildProjectSkillsIssue({
              code: "unmanaged-conflict",
              scope: "target",
              skillId: desired.skillId,
              relativeTarget,
              checkedAt,
            })
          );
          continue;
        }
        if (owned && !sameIdentity(owned.objectIdentity, existing)) {
          blockingIssues.push(
            buildProjectSkillsIssue({
              code: "managed-target-modified",
              scope: "target",
              skillId: desired.skillId,
              relativeTarget,
              checkedAt,
            })
          );
          continue;
        }
        blockingIssues.push(
          buildProjectSkillsIssue({
            code: "unmanaged-conflict",
            scope: "target",
            skillId: desired.skillId,
            relativeTarget,
            checkedAt,
          })
        );
        continue;
      }
      // Non-symlink exists.
      blockingIssues.push(
        buildProjectSkillsIssue({
          code: "unmanaged-conflict",
          scope: "target",
          skillId: desired.skillId,
          relativeTarget,
          checkedAt,
        })
      );
    } catch (error) {
      if (!isErrno(error, "ENOENT")) throw error;
      // Missing — safe create for enabled, valid library content.
      targetOperations.push({
        kind: "create-symlink",
        relativeTarget,
        skillId: desired.skillId,
        expectedRelativeLinkTarget: desired.expectedRelativeLinkTarget,
      });
      blockingIssues.push(
        buildProjectSkillsIssue({
          code: "projection-missing",
          scope: "target",
          skillId: desired.skillId,
          relativeTarget,
          checkedAt,
        })
      );
    }
  }

  // Delete owned projections that are no longer desired.
  for (const target of ownership?.targets ?? []) {
    if (desiredTargets.has(target.relativePath)) continue;
    const gitState = await ctx.inspectGitState(
      target.relativePath,
      live.realPath
    );
    if (gitState === "tracked") {
      confirmationRequirements.push({
        id: `confirm:git-delete:${target.relativePath}`,
        kind: "git-projection-delete",
        relativeTarget: target.relativePath,
        skillId: target.skillId,
        gitState,
      });
      if (opts?.safeOnly) {
        // ensureReady must not delete tracked projections without ack.
        continue;
      }
    }
    targetOperations.push({
      kind: "delete-symlink",
      relativeTarget: target.relativePath,
      skillId: target.skillId,
    });
  }

  return finalizePlan({
    observedRevision,
    ...(continuationOf === undefined ? {} : { continuationOf }),
    targetOperations,
    confirmationRequirements,
    blockingIssues,
  });
}
