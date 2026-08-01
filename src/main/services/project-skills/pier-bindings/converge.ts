import { randomUUID } from "node:crypto";
import type { PierHomeSkillDelivery } from "@shared/contracts/pier-home-skills.ts";
import type { ProjectRootRef as ContractProjectRootRef } from "@shared/contracts/project-skills.ts";
import {
  type ProjectRootRef as MainProjectRootRef,
  resolveStableProjectIdentity,
  toContractProjectRootRef,
} from "../identity.ts";
import type { createProjectSkillsPaths } from "../paths.ts";
import type { ProjectSkillsRepairService } from "../repair/service.ts";
import type { ProjectSkillsStore } from "../store/index.ts";
import type { PierBindingsChannel } from "./index.ts";

type ProjectRef = ContractProjectRootRef | MainProjectRootRef;

export type PierBindingsConvergeScope =
  | { kind: "project"; projectRef: ProjectRef }
  | { kind: "skill"; skillId: string }
  | { kind: "all-known-projects" };

export interface PierBindingsConvergeResult {
  converged: string[];
  failed: Array<{ message: string; rootKey: string }>;
}

export interface PierBindingsConverge {
  converge(
    scope: PierBindingsConvergeScope
  ): Promise<PierBindingsConvergeResult>;
}

interface ConvergeTarget {
  projectRef: ContractProjectRootRef;
  rootKey: string;
}

const NO_PROJECTS_ROOT_KEY = "(none)";
const NO_PROJECTS_MESSAGE =
  "No known projects to sync. Add or open a project, then try again.";
const LEDGER_NO_IDENTITY_MESSAGE =
  "pier-bindings ledger has no project identity; reopen the project to repair";

function blockedEnsureMessage(result: {
  issueSummary: Array<{ code: string }>;
  status: string;
}): string {
  const detail =
    result.issueSummary
      .map((issue) => issue.code)
      .slice(0, 3)
      .join(", ") || "blocked";
  return `ensureReady ${result.status}: ${detail}`;
}

export function createPierBindingsConverge(args: {
  listAlwaysIncludeSkills: () => Promise<
    Array<{ id: string; delivery: PierHomeSkillDelivery }>
  >;
  listKnownProjectRoots: () => Promise<Array<{ realPath: string }>>;
  paths: ReturnType<typeof createProjectSkillsPaths>;
  pierBindings: PierBindingsChannel;
  repairService: ProjectSkillsRepairService;
  store: ProjectSkillsStore;
}): PierBindingsConverge {
  async function resolveKnown(): Promise<ConvergeTarget[]> {
    const out: ConvergeTarget[] = [];
    const seen = new Set<string>();
    for (const root of await args.listKnownProjectRoots()) {
      try {
        const live = await resolveStableProjectIdentity(root.realPath);
        const rootKey = args.paths.rootKeyFor(live);
        if (seen.has(rootKey)) continue;
        seen.add(rootKey);
        out.push({ rootKey, projectRef: toContractProjectRootRef(live) });
      } catch {
        // Skip unresolvable roots.
      }
    }
    return out;
  }

  async function skillMentionedInLedger(
    rootKey: string,
    skillId: string
  ): Promise<boolean> {
    const desired = await args.pierBindings.readDesired(rootKey);
    return (
      desired.bindings.some((b) => b.skillId === skillId) ||
      Boolean(desired.publishedContentDigestsBySkillId[skillId]?.length)
    );
  }

  async function resolveFromLedgers(skillId: string | null): Promise<{
    targets: ConvergeTarget[];
    unresolvedRootKeys: string[];
  }> {
    const out: ConvergeTarget[] = [];
    const unresolvedRootKeys: string[] = [];
    const seen = new Set<string>();
    for (const rootKey of await args.pierBindings.listLedgerRootKeys()) {
      if (skillId && !(await skillMentionedInLedger(rootKey, skillId))) {
        continue;
      }
      const ownership = await args.store.readOwnership(rootKey);
      const identity = ownership?.projectIdentity;
      if (!identity?.realPath) {
        unresolvedRootKeys.push(rootKey);
        continue;
      }
      if (seen.has(rootKey)) continue;
      seen.add(rootKey);
      out.push({
        rootKey,
        projectRef: toContractProjectRootRef(identity),
      });
    }
    return { targets: out, unresolvedRootKeys };
  }

  function mergeTargets(batches: ConvergeTarget[][]): ConvergeTarget[] {
    const byKey = new Map<string, ConvergeTarget>();
    for (const batch of batches) {
      for (const item of batch) {
        byKey.set(item.rootKey, item);
      }
    }
    return [...byKey.values()];
  }

  async function ensureOne(
    projectRef: ProjectRef,
    rootKey: string
  ): Promise<{
    failed?: { message: string; rootKey: string };
    ok?: string;
  }> {
    try {
      const result = await args.repairService.ensureReady({
        projectRef,
        agentId: "pier-home-bindings",
        launchAttemptId: randomUUID(),
      });
      if (result.status !== "ready") {
        return {
          failed: {
            rootKey,
            message: blockedEnsureMessage(result),
          },
        };
      }
      return { ok: rootKey };
    } catch (error) {
      return {
        failed: {
          rootKey,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  return {
    async converge(scope) {
      let targets: ConvergeTarget[] = [];
      const failed: Array<{ message: string; rootKey: string }> = [];
      let requiresProjects = false;

      if (scope.kind === "project") {
        const claimed =
          "identity" in scope.projectRef
            ? scope.projectRef.identity
            : {
                realPath: scope.projectRef.realPath,
                volumeId: scope.projectRef.volumeIdentity,
                directoryIdentity: scope.projectRef.directoryIdentity,
              };
        const live = await resolveStableProjectIdentity(claimed.realPath);
        targets = [
          {
            rootKey: args.paths.rootKeyFor(live),
            projectRef: toContractProjectRootRef(live),
          },
        ];
        requiresProjects = true;
      } else if (scope.kind === "all-known-projects") {
        targets = await resolveKnown();
        requiresProjects = true;
      } else {
        const always = await args.listAlwaysIncludeSkills();
        const isAlways = always.some((s) => s.id === scope.skillId);
        const fromLedgers = await resolveFromLedgers(scope.skillId);
        requiresProjects =
          isAlways ||
          fromLedgers.targets.length > 0 ||
          fromLedgers.unresolvedRootKeys.length > 0;
        targets = mergeTargets([
          requiresProjects ? await resolveKnown() : [],
          fromLedgers.targets,
        ]);
        const resolvedKeys = new Set(targets.map((item) => item.rootKey));
        for (const rootKey of fromLedgers.unresolvedRootKeys) {
          if (resolvedKeys.has(rootKey)) continue;
          failed.push({
            rootKey,
            message: LEDGER_NO_IDENTITY_MESSAGE,
          });
        }
      }

      if (requiresProjects && targets.length === 0 && failed.length === 0) {
        failed.push({
          rootKey: NO_PROJECTS_ROOT_KEY,
          message: NO_PROJECTS_MESSAGE,
        });
        return { converged: [], failed };
      }

      const converged: string[] = [];
      for (const target of targets) {
        const result = await ensureOne(target.projectRef, target.rootKey);
        if (result.ok) converged.push(result.ok);
        if (result.failed) failed.push(result.failed);
      }
      return { converged, failed };
    },
  };
}
