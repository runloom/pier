import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectRootRef as ContractProjectRootRef } from "../../../shared/contracts/project-skills.ts";
import type {
  ProjectRootRef as MainProjectRootRef,
  StableProjectIdentity,
} from "./identity.ts";
import {
  expectedLinkTargetFor,
  inspectLibraryContent,
} from "./library-state.ts";
import type { GitFiveState, PlanTargetOperation } from "./plan-types.ts";
import {
  computePlanDigest,
  type NormalizedProjectSkillsDraft,
  type ProjectSkillsPlan,
} from "./plan-types.ts";

/** Pure I/O + normalization helpers for plan.ts (file-size cap split). */

export function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

export function toIdentity(
  projectRef: ContractProjectRootRef | MainProjectRootRef
): StableProjectIdentity {
  if ("identity" in projectRef) {
    return projectRef.identity;
  }
  return {
    realPath: projectRef.realPath,
    volumeId: projectRef.volumeIdentity,
    directoryIdentity: projectRef.directoryIdentity,
  };
}

export async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await lstat(absolutePath);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw error;
  }
}

export async function defaultInspectGitState(
  relativeTarget: string,
  projectRoot: string
): Promise<GitFiveState> {
  const absolute = join(projectRoot, ...relativeTarget.split("/"));
  if (!(await pathExists(absolute))) return "absent";
  return "unknown";
}

export function expectedLinkTarget(skillId: string): string {
  // Both delivery roots (`.agents/skills`, `.claude/skills`) are two levels
  // deep; the shared derivation owns the general form.
  return expectedLinkTargetFor(skillId, ".agents/skills");
}

export function compareOps(
  a: PlanTargetOperation,
  b: PlanTargetOperation
): number {
  const byTarget = a.relativeTarget.localeCompare(b.relativeTarget);
  if (byTarget !== 0) return byTarget;
  return a.kind.localeCompare(b.kind);
}

/** Empty, non-applicable plan (identity change / invalid manifest). */
export function emptyBlockedPlan(args: {
  observedRevision: string;
  normalizedDraft: NormalizedProjectSkillsDraft;
  blockingIssues: ProjectSkillsPlan["blockingIssues"];
}): ProjectSkillsPlan {
  return {
    observedRevision: args.observedRevision,
    normalizedDraft: args.normalizedDraft,
    targetOperations: [],
    gitStates: [],
    confirmationRequirements: [],
    blockingIssues: args.blockingIssues,
    planDigest: computePlanDigest({
      normalizedDraft: args.normalizedDraft,
      observedRevision: args.observedRevision,
      targetOperations: [],
      gitStates: [],
      confirmationRequirements: [],
    }),
    applicable: false,
  };
}

/**
 * Content-delete confirmation for a staged deletion, bound to the ACTUAL
 * tree digest (design §4.4: content changing after the confirmation must
 * surface as content-conflict, not get silently deleted). Null when the
 * library directory is already gone.
 */
export async function contentDeleteRequirement(
  projectRoot: string,
  skillId: string,
  manifestContentDigest: string
): Promise<{
  id: string;
  kind: "content-delete";
  skillId: string;
  expectedActualTreeDigest?: string;
} | null> {
  const libraryDir = join(projectRoot, ".pier", "skills", "library", skillId);
  if (!(await pathExists(libraryDir))) {
    return null;
  }
  const inspection = await inspectLibraryContent(
    projectRoot,
    skillId,
    manifestContentDigest
  );
  return {
    id: `confirm:content-delete:${skillId}`,
    kind: "content-delete",
    skillId,
    ...(inspection.actualDigest === null
      ? {}
      : { expectedActualTreeDigest: inspection.actualDigest }),
  };
}
