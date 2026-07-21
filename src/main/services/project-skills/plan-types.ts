import { createHash } from "node:crypto";
import type {
  ProjectRootRef as ContractProjectRootRef,
  ProjectSkillsDraft,
} from "../../../shared/contracts/project-skills.ts";
import type { SkillDiscoveryAdapterRegistry } from "./adapters.ts";
import type { ProjectSkillsIssue } from "./health.ts";
import type { ProjectRootRef as MainProjectRootRef } from "./identity.ts";
import type { ProjectSkillsStore } from "./store.ts";

/**
 * Plan types, draft normalization, and the planDigest computation, split
 * from plan.ts (file-size cap). Behavior unchanged.
 */

export type GitFiveState =
  | "absent"
  | "ignored"
  | "untracked"
  | "tracked"
  | "unknown";

export interface PlanGitState {
  relativeTarget: string;
  state: GitFiveState;
}

export type PlanTargetOperation =
  | {
      kind: "create-symlink";
      relativeTarget: string;
      skillId: string;
      expectedRelativeLinkTarget: string;
    }
  | {
      kind: "delete-symlink";
      relativeTarget: string;
      skillId: string;
    }
  | {
      kind: "noop";
      relativeTarget: string;
      skillId: string;
    };

export type PlanConfirmationRequirement =
  | {
      id: string;
      kind: "git-projection-delete";
      relativeTarget: string;
      skillId: string;
      gitState: GitFiveState;
    }
  | {
      id: string;
      kind: "content-delete";
      skillId: string;
      expectedActualTreeDigest?: string;
    };

export interface NormalizedProjectSkillsDraft {
  deleteSkillIds: string[];
  deliveryAgents: boolean;
  deliveryClaude: boolean;
  enabledBySkillId: Record<string, boolean>;
  importTokens: string[];
}

export interface ProjectSkillsPlan {
  applicable: boolean;
  blockingIssues: ProjectSkillsIssue[];
  confirmationRequirements: PlanConfirmationRequirement[];
  gitStates: PlanGitState[];
  normalizedDraft: NormalizedProjectSkillsDraft;
  observedRevision: string;
  planDigest: string;
  targetOperations: PlanTargetOperation[];
}

export interface ProjectSkillsPlanService {
  plan(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    observedRevision: string,
    draft: ProjectSkillsDraft
  ): Promise<ProjectSkillsPlan>;
}

export interface CreateProjectSkillsPlanServiceOptions {
  adapterRegistry?: SkillDiscoveryAdapterRegistry;
  getObservedRevision?: (projectRoot: string) => Promise<string>;
  /**
   * Injected Git five-state inspector (tests). Production can wire real git.
   * Defaults to "unknown" when a target exists, "absent" when missing.
   */
  inspectGitState?: (
    relativeTarget: string,
    projectRoot: string
  ) => Promise<GitFiveState>;
  now?: () => number;
  store?: ProjectSkillsStore;
  userData: string;
}

function sortRecordKeys(
  record: Record<string, boolean>
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of Object.keys(record).sort()) {
    out[key] = record[key] === true;
  }
  return out;
}

/** Stable, order-independent draft normalization for planDigest input. */
export function normalizeProjectSkillsDraft(
  draft: ProjectSkillsDraft
): NormalizedProjectSkillsDraft {
  return {
    deliveryAgents: draft.deliveryAgents === true,
    deliveryClaude: draft.deliveryClaude === true,
    enabledBySkillId: sortRecordKeys(draft.enabledBySkillId ?? {}),
    importTokens: [...(draft.importTokens ?? [])].sort(),
    deleteSkillIds: [...(draft.deleteSkillIds ?? [])].sort(),
  };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * planDigest inputs (design §4.1):
 * normalized draft, observedRevision, ordered target ops, git five-state,
 * confirmation requirements. No localized text / checkedAt.
 */
export function computePlanDigest(input: {
  normalizedDraft: NormalizedProjectSkillsDraft;
  observedRevision: string;
  targetOperations: readonly PlanTargetOperation[];
  gitStates: readonly PlanGitState[];
  confirmationRequirements: readonly PlanConfirmationRequirement[];
}): string {
  const payload = {
    v: 2 as const,
    normalizedDraft: input.normalizedDraft,
    observedRevision: input.observedRevision,
    targetOperations: input.targetOperations,
    gitStates: input.gitStates,
    confirmationRequirements: input.confirmationRequirements,
  };
  return `sha256:${createHash("sha256")
    .update("project-skills-plan-digest-v2\0", "utf8")
    .update(canonicalJson(payload), "utf8")
    .digest("hex")}`;
}
