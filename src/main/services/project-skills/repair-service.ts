import { join } from "node:path";
import type { ProjectRootRef as ContractProjectRootRef } from "../../../shared/contracts/project-skills.ts";
import {
  createProjectSkillsFileSystemAdapter,
  type ProjectSkillsFileSystemAdapter,
} from "./fs-adapter.ts";
import {
  type ProjectRootRef as MainProjectRootRef,
  resolveStableProjectIdentity,
  type StableProjectIdentity,
} from "./identity.ts";
import type { ProjectSkillsLock } from "./lock.ts";
import { createObservedRevisionProvider } from "./observed-revision.ts";
import { createProjectSkillsPaths } from "./paths.ts";
import type { GitFiveState } from "./plan.ts";
import { defaultInspectGitState } from "./plan-helpers.ts";
import { ensureReady as runEnsureReady } from "./repair-ensure-ready.ts";
import {
  type EnsureReadyResult,
  type ProjectSkillsRepairPlan,
  type ReconcileResult,
  type RepairContext,
  type RepairRequest,
  readRepairRecoveryLog,
  toIdentity,
} from "./repair-log.ts";
import type { DesiredSystemProjection } from "./repair-plan-builder.ts";
import { buildRepairPlan } from "./repair-plan-builder.ts";
import { prepareLog } from "./repair-prepare.ts";
import { drive } from "./repair-reconcile.ts";
import { createProjectSkillsStore, type ProjectSkillsStore } from "./store.ts";

export type {
  EnsureReadyResult,
  ProjectSkillsRepairPlan,
  ReconcileResult,
  RepairRequest,
  RepairTransactionPhase,
} from "./repair-log.ts";
export {
  computeRepairPlanDigest,
  computeRepairRequestDigest,
  ProjectSkillsRepairError,
  readRepairRecoveryLog,
  repairLogPath,
  writeRepairRecoveryLog,
} from "./repair-log.ts";

export interface ProjectSkillsRepairService {
  /** Exposed for recovery of repair logs. */
  continueFromLog(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    operationId: string
  ): Promise<ReconcileResult>;
  ensureReady(args: {
    projectRef: ContractProjectRootRef | MainProjectRootRef;
    agentId: string;
    launchAttemptId: string;
  }): Promise<EnsureReadyResult>;
  repair(request: RepairRequest): Promise<ReconcileResult>;
  repairPlan(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    observedRevision: string,
    continuationOf?: string
  ): Promise<ProjectSkillsRepairPlan>;
}

export interface CreateProjectSkillsRepairServiceOptions {
  /** When true, ensureReady will not attempt auto-repair writes (tests). */
  disableEnsureReadyRepair?: boolean;
  fs?: ProjectSkillsFileSystemAdapter;
  getObservedRevision?: (projectRoot: string) => Promise<string>;
  inspectGitState?: (
    relativeTarget: string,
    projectRoot: string
  ) => Promise<GitFiveState>;
  lock: ProjectSkillsLock;
  now?: () => number;
  onInvalidated?: (event: {
    projectIdentity: string;
    observedRevision: string;
  }) => void;
  store?: ProjectSkillsStore;
  /**
   * Pier system skills channel (design v8 §8): reconciled inside the
   * ensureReady lock before the launch decision — injection completes before
   * spawn or the launch is blocked.
   */
  systemSkills?: {
    reconcile(args: {
      projectIdentity: StableProjectIdentity;
      rootKey: string;
    }): Promise<{ desiredProjections: DesiredSystemProjection[] }>;
  };
  userData: string;
}

export function createProjectSkillsRepairService(
  options: CreateProjectSkillsRepairServiceOptions
): ProjectSkillsRepairService {
  const paths = createProjectSkillsPaths(options.userData);
  const store =
    options.store ?? createProjectSkillsStore({ userData: options.userData });
  const fs = options.fs ?? createProjectSkillsFileSystemAdapter();
  const lock = options.lock;
  const now = options.now ?? Date.now;
  const inspectGitState = options.inspectGitState ?? defaultInspectGitState;
  const getObservedRevision =
    options.getObservedRevision ??
    createObservedRevisionProvider({ store, userData: options.userData });

  const ctx: RepairContext = {
    fs,
    getObservedRevision,
    inspectGitState,
    now,
    paths,
    store,
  };
  if (options.onInvalidated !== undefined) {
    ctx.onInvalidated = options.onInvalidated;
  }

  return {
    async repairPlan(projectRef, observedRevision, continuationOf) {
      return buildRepairPlan(ctx, projectRef, observedRevision, continuationOf);
    },

    async repair(request) {
      const claimed = toIdentity(request.projectRef);
      const live = await resolveStableProjectIdentity(claimed.realPath);
      const rootKey = paths.rootKeyFor(live);
      const lockPaths = [
        live.realPath,
        paths.projectDir(rootKey),
        join(live.realPath, ".pier"),
        join(live.realPath, ".agents"),
      ];
      return lock.runExclusive(live, lockPaths, async () => {
        const log = await prepareLog(ctx, request);
        if (log.finalizedResult) return log.finalizedResult;
        return drive(ctx, log);
      });
    },

    async continueFromLog(projectRef, operationId) {
      const claimed = toIdentity(projectRef);
      const live = await resolveStableProjectIdentity(claimed.realPath);
      const rootKey = paths.rootKeyFor(live);
      const lockPaths = [
        live.realPath,
        paths.projectDir(rootKey),
        join(live.realPath, ".pier"),
        join(live.realPath, ".agents"),
      ];
      return lock.runExclusive(live, lockPaths, async () => {
        const log = await readRepairRecoveryLog(
          paths.operationsDir(rootKey),
          operationId
        );
        if (!log) {
          return {
            status: "not-applied" as const,
            operationId,
            reason: "missing-repair-log",
          };
        }
        if (log.finalizedResult) return log.finalizedResult;
        return drive(ctx, log);
      });
    },

    async ensureReady(args) {
      const deps: Parameters<typeof runEnsureReady>[0] = { ctx, lock };
      if (options.disableEnsureReadyRepair !== undefined) {
        deps.disableEnsureReadyRepair = options.disableEnsureReadyRepair;
      }
      if (options.systemSkills !== undefined) {
        deps.systemSkills = options.systemSkills;
      }
      return runEnsureReady(deps, args);
    },
  };
}
