import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ApplyResult,
  ProjectRootRef as ContractProjectRootRef,
  ProjectSkillsAcknowledgement,
  ProjectSkillsDraft,
  SkillContentRef,
  SkillContentResult,
} from "../../../shared/contracts/project-skills.ts";
import type { FilePathTransactionLock } from "../file-path-transaction-lock.ts";
import {
  createSkillDiscoveryAdapterRegistry,
  type SkillDiscoveryAdapterRegistry,
} from "./adapters.ts";
import {
  type CreateProjectSkillsApplyServiceOptions,
  createProjectSkillsApplyService,
  type ProjectSkillsApplyService,
} from "./apply-service.ts";
import {
  createProjectSkillsHealthService,
  type ProjectSkillsHealthService,
  type SnapshotHealth,
} from "./health.ts";
import {
  type ProjectRootRef as MainProjectRootRef,
  resolveStableProjectIdentity,
  type StableProjectIdentity,
  toContractProjectRootRef,
} from "./identity.ts";
import {
  type CreateProjectSkillsImportServiceOptions,
  createProjectSkillsImportService,
  type ImportCandidateView,
  type OpenDirectoryDialog,
  type ProjectSkillsImportService,
} from "./import-service.ts";
import { createProjectSkillsLock, type ProjectSkillsLock } from "./lock.ts";
import { createObservedRevisionProvider } from "./observed-revision.ts";
import { createProjectSkillsPaths } from "./paths.ts";
import {
  createProjectSkillsPlanService,
  type ProjectSkillsPlan,
  type ProjectSkillsPlanService,
} from "./plan.ts";
import {
  createProjectSkillsRecoveryCoordinator,
  type OperationStatusView,
  type ProjectSkillsRecoveryCoordinator,
} from "./recovery.ts";
import {
  createProjectSkillsRepairService,
  type EnsureReadyResult,
  type ProjectSkillsRepairPlan,
  type ProjectSkillsRepairService,
  type ReconcileResult,
  type RepairRequest,
} from "./repair-service.ts";
import { readSkillContent } from "./skill-content.ts";
import {
  buildProjectSnapshot,
  type ProjectSkillsProjectSummary,
  type ProjectSkillsSnapshot,
  readManifestFile,
  type SnapshotBuilderCtx,
} from "./snapshot-builder.ts";

export type {
  ProjectSkillsProjectSummary,
  ProjectSkillsSnapshot,
} from "./snapshot-builder.ts";

import { createProjectSkillsStore, type ProjectSkillsStore } from "./store.ts";
import type { SystemSkillsChannel } from "./system-skills.ts";

export interface ProjectSkillsService {
  apply(request: {
    projectRef: ContractProjectRootRef | MainProjectRootRef;
    observedRevision: string;
    draft: ProjectSkillsDraft;
    planDigest: string;
    operationId: string;
    acknowledgements: readonly ProjectSkillsAcknowledgement[];
  }): Promise<ApplyResult>;
  doctor(
    projectRef: ContractProjectRootRef | MainProjectRootRef
  ): Promise<SnapshotHealth>;
  ensureReady(args: {
    projectRef: ContractProjectRootRef | MainProjectRootRef;
    agentId: string;
    launchAttemptId: string;
  }): Promise<EnsureReadyResult>;
  importDiscard(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    token: string
  ): Promise<void>;
  importPrepare(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    globalSource?: { root: string; directoryName: string }
  ): Promise<ImportCandidateView | null>;
  importPrepareContentUpdate(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    args: { skillId: string; baseContentDigest: string; skillMd: string }
  ): Promise<ImportCandidateView>;
  importPrepareDriftAcceptance(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    args: { skillId: string }
  ): Promise<ImportCandidateView>;
  importPrepareFromDiscovery(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    relativeSource: string
  ): Promise<ImportCandidateView>;
  importPrepareTemplate(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    args: { skillId: string; description: string }
  ): Promise<ImportCandidateView>;
  operationStatus(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    operationId: string
  ): Promise<OperationStatusView>;
  plan(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    observedRevision: string,
    draft: ProjectSkillsDraft
  ): Promise<ProjectSkillsPlan>;
  projectsSnapshot(
    projectRootPath?: string
  ): Promise<ProjectSkillsProjectSummary[]>;
  repair(request: RepairRequest): Promise<ReconcileResult>;
  repairPlan(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    observedRevision: string,
    continuationOf?: string
  ): Promise<ProjectSkillsRepairPlan>;
  skillRead(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    ref: SkillContentRef
  ): Promise<SkillContentResult>;
  snapshot(
    ref: ContractProjectRootRef | MainProjectRootRef
  ): Promise<ProjectSkillsSnapshot>;
}

export interface CreateProjectSkillsServiceOptions {
  adapterRegistry?: SkillDiscoveryAdapterRegistry;
  applyService?: ProjectSkillsApplyService;
  defaultCaller?: CreateProjectSkillsImportServiceOptions["defaultCaller"];
  getObservedRevision?: (projectRoot: string) => Promise<string>;
  healthService?: ProjectSkillsHealthService;
  importService?: ProjectSkillsImportService;
  inspectGitState?: CreateProjectSkillsApplyServiceOptions["inspectGitState"];
  /** Installed agent ids for the effective matrix (agent-detection). */
  listInstalledAgents?: () => Promise<readonly string[]>;
  /** Known project roots for projectsSnapshot (shared index + panels). */
  listKnownProjectRoots?: () => Promise<
    Array<{ realPath: string; source: ProjectSkillsProjectSummary["source"] }>
  >;
  lock?: ProjectSkillsLock;
  now?: () => number;
  onInvalidated?: (event: {
    projectIdentity: string;
    observedRevision: string;
  }) => void;
  planService?: ProjectSkillsPlanService;
  recovery?: ProjectSkillsRecoveryCoordinator;
  repairService?: ProjectSkillsRepairService;
  /** Cross-profile shared lock root; defaults to ~/.pier/project-skills-locks. */
  sharedLockRoot?: string;
  showOpenDialog?: OpenDirectoryDialog;
  store?: ProjectSkillsStore;
  systemSkills?: SystemSkillsChannel;
  /** REQUIRED: same singleton as files service. */
  transactionLock: FilePathTransactionLock;
  userData: string;
}

function projectIdentityKey(identity: StableProjectIdentity): string {
  return `${identity.volumeId}:${identity.directoryIdentity}`;
}

export function createProjectSkillsService(
  options: CreateProjectSkillsServiceOptions
): ProjectSkillsService {
  if (!options.transactionLock) {
    throw new Error(
      "transactionLock is required (inject FilePathTransactionLock singleton shared with files)"
    );
  }

  const userData = options.userData;
  const now = options.now ?? Date.now;
  const sharedLockRoot =
    options.sharedLockRoot ?? join(homedir(), ".pier", "project-skills-locks");
  const store = options.store ?? createProjectSkillsStore({ userData });
  const paths = createProjectSkillsPaths(userData);
  const registry =
    options.adapterRegistry ?? createSkillDiscoveryAdapterRegistry();
  const lock =
    options.lock ??
    createProjectSkillsLock({
      transactionLock: options.transactionLock,
      sharedLockRoot,
    });

  const onInvalidated = options.onInvalidated;

  const emitInvalidated = (
    identity: StableProjectIdentity,
    observedRevision: string
  ): void => {
    onInvalidated?.({
      projectIdentity: projectIdentityKey(identity),
      observedRevision,
    });
  };

  // Real derivation by default (design v8 §3.2); tests may inject a stub.
  const getObservedRevision =
    options.getObservedRevision ??
    createObservedRevisionProvider({ store, userData });

  const sharedInject = {
    getObservedRevision,
    ...(options.inspectGitState
      ? { inspectGitState: options.inspectGitState }
      : {}),
  };

  const planService =
    options.planService ??
    createProjectSkillsPlanService({
      userData,
      store,
      adapterRegistry: registry,
      now,
      ...sharedInject,
    });

  const applyService =
    options.applyService ??
    createProjectSkillsApplyService({
      userData,
      lock,
      store,
      planService,
      now,
      ...sharedInject,
    });

  const repairService =
    options.repairService ??
    createProjectSkillsRepairService({
      userData,
      lock,
      store,
      now,
      ...sharedInject,
      ...(options.systemSkills ? { systemSkills: options.systemSkills } : {}),
      ...(onInvalidated
        ? { onInvalidated: (event) => onInvalidated(event) }
        : {}),
    });

  const importService =
    options.importService ??
    createProjectSkillsImportService({
      userData,
      lock,
      store,
      now,
      ...(options.showOpenDialog
        ? { showOpenDialog: options.showOpenDialog }
        : {}),
      ...(options.defaultCaller
        ? { defaultCaller: options.defaultCaller }
        : {}),
    });

  const healthService =
    options.healthService ??
    createProjectSkillsHealthService({
      userData,
      store,
      adapterRegistry: registry,
      now,
    });

  const recovery =
    options.recovery ??
    createProjectSkillsRecoveryCoordinator({
      userData,
      lock,
      store,
      applyService,
      now,
      repairContinueFromLog: (projectRef, operationId) =>
        repairService.continueFromLog(projectRef, operationId),
      ...sharedInject,
    });

  /**
   * Bounded crash-leftover convergence before reads and launches (design
   * §4.2.1 / §5.2.2). Runs outside the project lock; never throws.
   */
  async function sweepRecovery(
    projectRef: Parameters<typeof recovery.sweepPendingOperations>[0]
  ): Promise<void> {
    try {
      await recovery.sweepPendingOperations(projectRef, { max: 2 });
    } catch {
      // Sweep is best-effort; reads proceed on the current state.
    }
  }

  async function readInstalledAgents(): Promise<
    ReadonlySet<string> | undefined
  > {
    if (!options.listInstalledAgents) return;
    try {
      return new Set(await options.listInstalledAgents());
    } catch {
      return;
    }
  }

  const snapshotCtx: SnapshotBuilderCtx = {
    paths,
    store,
    registry,
    healthService,
    now,
    getObservedRevision,
    readInstalledAgents,
    systemSkills: options.systemSkills,
  };

  return {
    async projectsSnapshot(projectRootPath) {
      const knownRoots = (await options.listKnownProjectRoots?.()) ?? [];
      const roots = projectRootPath
        ? [
            { realPath: projectRootPath, source: "panel" as const },
            ...knownRoots.filter((root) => root.realPath !== projectRootPath),
          ]
        : knownRoots;
      const checkedAt = now();
      const summaries: ProjectSkillsProjectSummary[] = [];
      const seen = new Map<string, ProjectSkillsProjectSummary>();
      for (const root of roots) {
        try {
          const identity = await resolveStableProjectIdentity(root.realPath);
          const key = projectIdentityKey(identity);
          const existing = seen.get(key);
          if (existing) {
            // "environment" is the stronger fact (explicitly added to the
            // shared index); a duplicate panel entry must not mask it —
            // direct-to-detail semantics depend on it (design v8 §7.1).
            if (root.source === "environment" && existing.source === "panel") {
              existing.source = "environment";
            }
            continue;
          }
          const manifest = await readManifestFile(identity.realPath);
          const skillCount =
            manifest.status === "present" ? manifest.manifest.skills.length : 0;
          let readStatus: ProjectSkillsProjectSummary["readStatus"] = "error";
          if (manifest.status === "present") readStatus = "ok";
          else if (manifest.status === "absent")
            readStatus = "missing-manifest";
          else readStatus = "invalid-manifest";
          const summary: ProjectSkillsProjectSummary = {
            projectRef: toContractProjectRootRef(identity),
            displayPath: identity.realPath,
            source: root.source,
            skillCount,
            readStatus,
            checkedAt,
          };
          seen.set(key, summary);
          summaries.push(summary);
        } catch (error) {
          if (root.realPath === projectRootPath) {
            throw error;
          }
          // Skip unreadable roots.
        }
      }
      return summaries;
    },

    async snapshot(ref) {
      await sweepRecovery(ref);
      return buildProjectSnapshot(snapshotCtx, ref);
    },

    plan(projectRef, observedRevision, draft) {
      return planService.plan(projectRef, observedRevision, draft);
    },

    async apply(request) {
      const result = await applyService.apply(request);
      const claimed =
        "identity" in request.projectRef
          ? request.projectRef.identity
          : {
              realPath: request.projectRef.realPath,
              volumeId: request.projectRef.volumeIdentity,
              directoryIdentity: request.projectRef.directoryIdentity,
            };
      if (result.status === "converged" || result.status === "degraded") {
        emitInvalidated(claimed, result.revisions.observedRevision);
      }
      return result;
    },

    repairPlan(projectRef, observedRevision, continuationOf) {
      return repairService.repairPlan(
        projectRef,
        observedRevision,
        continuationOf
      );
    },

    repair(request) {
      return repairService.repair(request);
    },

    doctor(projectRef) {
      return healthService.doctor(projectRef);
    },

    async operationStatus(projectRef, operationId) {
      // Read-only: recovery is driven by snapshot/ensureReady sweep, not by
      // the status poller (§4.1). Returning pending is enough for the UI to
      // keep polling until a terminal record appears.
      return recovery.operationStatus(projectRef, operationId);
    },

    async ensureReady(args) {
      await sweepRecovery(args.projectRef);
      return repairService.ensureReady(args);
    },

    importPrepare(projectRef, globalSource) {
      return importService.prepareLocalImport(
        projectRef,
        undefined,
        globalSource
      );
    },

    importPrepareFromDiscovery(projectRef, relativeSource) {
      return importService.prepareFromDiscovery(projectRef, relativeSource);
    },

    importPrepareTemplate(projectRef, args) {
      return importService.prepareTemplate(projectRef, args);
    },

    importPrepareContentUpdate(projectRef, args) {
      return importService.prepareContentUpdate(projectRef, args);
    },

    importPrepareDriftAcceptance(projectRef, args) {
      return importService.prepareDriftAcceptance(projectRef, args);
    },

    importDiscard(projectRef, token) {
      return importService.discardImport(projectRef, token);
    },

    skillRead(projectRef, ref) {
      return readSkillContent({ projectRef, ref, registry });
    },
  };
}
