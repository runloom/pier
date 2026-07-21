import { join } from "node:path";
import type {
  ApplyResult,
  ProjectRootRef as ContractProjectRootRef,
} from "../../../shared/contracts/project-skills.ts";
import {
  type ApplyCtx,
  type ApplyHooks,
  type ApplyRecoveryLog,
  type ApplyRequest,
  computeApplyRequestDigest,
  ensureDir,
  ProjectSkillsApplyError,
  toIdentity,
} from "./apply-log.ts";
import { readApplyRecoveryLog, writeApplyRecoveryLog } from "./apply-log-io.ts";
import { drive } from "./apply-phases.ts";
import { prepareLog } from "./apply-prepare.ts";
import {
  createProjectSkillsFileSystemAdapter,
  type ProjectSkillsFileSystemAdapter,
} from "./fs-adapter.ts";
import {
  type ProjectRootRef as MainProjectRootRef,
  resolveStableProjectIdentity,
} from "./identity.ts";
import type { ProjectSkillsLock } from "./lock.ts";
import { createObservedRevisionProvider } from "./observed-revision.ts";
import { createProjectSkillsPaths } from "./paths.ts";
import {
  createProjectSkillsPlanService,
  type GitFiveState,
  type ProjectSkillsPlanService,
} from "./plan.ts";
import {
  createProjectSkillsStore,
  ProjectSkillsOperationConflict,
  type ProjectSkillsStore,
} from "./store.ts";

export {
  type CleanupLibraryResult,
  cleanupLibrarySkillByIdentity,
} from "./apply-content.ts";
export {
  type ApplyHookContext,
  type ApplyHooks,
  type ApplyRecoveryLog,
  type ApplyRequest,
  type ApplyTransactionPhase,
  type CleanupEntryExpectation,
  computeApplyRequestDigest,
  ProjectSkillsApplyError,
} from "./apply-log.ts";
export {
  readApplyRecoveryLog,
  recoveryLogPath,
  writeApplyRecoveryLog,
} from "./apply-log-io.ts";

export interface ProjectSkillsApplyService {
  apply(request: ApplyRequest): Promise<ApplyResult | never>;
  /** Exposed for recovery coordinator. */
  continueFromLog(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    operationId: string
  ): Promise<ApplyResult | { status: "not-applied"; operationId: string }>;
  plan: ProjectSkillsPlanService["plan"];
}

export interface CreateProjectSkillsApplyServiceOptions {
  fs?: ProjectSkillsFileSystemAdapter;
  /** Live observed revision; defaults to the request value (tests). */
  getObservedRevision?: (projectRoot: string) => Promise<string>;
  hooks?: ApplyHooks;
  inspectGitState?: (
    relativeTarget: string,
    projectRoot: string
  ) => Promise<GitFiveState>;
  lock: ProjectSkillsLock;
  now?: () => number;
  planService?: ProjectSkillsPlanService;
  /**
   * Resolve staging tree for an import token. Defaults to
   * `{userData}/project-skills/<rootKey>/staging/<token>/tree`.
   */
  resolveStagingTreePath?: (rootKey: string, token: string) => string | null;
  store?: ProjectSkillsStore;
  userData: string;
}

export function createProjectSkillsApplyService(
  options: CreateProjectSkillsApplyServiceOptions
): ProjectSkillsApplyService {
  const paths = createProjectSkillsPaths(options.userData);
  const store =
    options.store ?? createProjectSkillsStore({ userData: options.userData });
  const fs = options.fs ?? createProjectSkillsFileSystemAdapter();
  const now = options.now ?? Date.now;
  const hooks = options.hooks;
  const lock = options.lock;
  const getObservedRevision =
    options.getObservedRevision ??
    createObservedRevisionProvider({ store, userData: options.userData });

  const planService =
    options.planService ??
    createProjectSkillsPlanService({
      userData: options.userData,
      store,
      getObservedRevision,
      ...(options.inspectGitState === undefined
        ? {}
        : { inspectGitState: options.inspectGitState }),
      now,
    });

  const resolveStagingTreePath =
    options.resolveStagingTreePath ??
    ((rootKey: string, token: string) =>
      join(paths.stagingDir(rootKey), token, "tree"));

  const ctx: ApplyCtx = {
    fs,
    getObservedRevision,
    hooks,
    now,
    paths,
    planService,
    resolveStagingTreePath,
    store,
  };

  return {
    plan: (projectRef, observedRevision, draft) =>
      planService.plan(projectRef, observedRevision, draft),

    async apply(request) {
      const claimed = toIdentity(request.projectRef);
      const live = await resolveStableProjectIdentity(claimed.realPath);
      const rootKey = paths.rootKeyFor(live);
      const lockPaths = [
        live.realPath,
        paths.projectDir(rootKey),
        join(live.realPath, ".pier"),
        join(live.realPath, ".agents"),
      ];

      return await lock.runExclusive(live, lockPaths, async () => {
        const requestDigest = computeApplyRequestDigest({
          operationId: request.operationId,
          planDigest: request.planDigest,
          observedRevision: request.observedRevision,
          draft: request.draft,
          acknowledgements: request.acknowledgements,
        });

        const existing = await store.readOperation(
          rootKey,
          request.operationId
        );
        if (existing?.kind === "terminal") {
          if (existing.requestDigest !== requestDigest) {
            throw new ProjectSkillsOperationConflict(
              `operation ${request.operationId} requestDigest mismatch`
            );
          }
          const result = existing.result as
            | ApplyResult
            | { status: "not-applied"; operationId: string };
          if (
            result &&
            typeof result === "object" &&
            "status" in result &&
            (result.status === "converged" ||
              result.status === "degraded" ||
              result.status === "indeterminate")
          ) {
            return result as ApplyResult;
          }
          // Terminal not-applied stored as non-ApplyResult — rethrow typed.
          throw new ProjectSkillsApplyError(
            "not-applied",
            "operation previously not-applied",
            request.operationId
          );
        }

        if (existing?.kind === "in-flight") {
          if (existing.requestDigest !== requestDigest) {
            throw new ProjectSkillsOperationConflict(
              `operation ${request.operationId} requestDigest mismatch`
            );
          }
          // Continue from recovery log.
          const log = await readApplyRecoveryLog(
            paths.operationsDir(rootKey),
            request.operationId
          );
          if (!log) {
            throw new ProjectSkillsApplyError(
              "indeterminate",
              "in-flight operation missing recovery log",
              request.operationId
            );
          }
          const continued = await drive(ctx, log);
          if (continued.status === "not-applied") {
            throw new ProjectSkillsApplyError(
              "not-applied",
              "operation not-applied",
              request.operationId
            );
          }
          return continued;
        }

        // Fresh apply.
        let log: ApplyRecoveryLog;
        try {
          log = await prepareLog(ctx, request);
        } catch (error) {
          if (error instanceof ProjectSkillsApplyError) throw error;
          if (error instanceof ProjectSkillsOperationConflict) throw error;
          throw error;
        }

        // Durable PREPARED before any project write.
        await ensureDir(paths.operationsDir(rootKey));
        await writeApplyRecoveryLog(paths.operationsDir(rootKey), log);
        await store.writeOperation(rootKey, request.operationId, {
          kind: "in-flight",
          phase: "PREPARED",
          requestDigest: log.requestDigest,
        });
        await fs
          .syncDirectory(paths.operationsDir(rootKey))
          .catch(() => undefined);

        const outcome = await drive(ctx, log);
        if (outcome.status === "not-applied") {
          throw new ProjectSkillsApplyError(
            "not-applied",
            "operation not-applied",
            request.operationId
          );
        }
        return outcome;
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
      return await lock.runExclusive(live, lockPaths, async () => {
        const existing = await store.readOperation(rootKey, operationId);
        if (existing?.kind === "terminal") {
          const result = existing.result as
            | ApplyResult
            | { status: "not-applied"; operationId: string };
          if (
            result &&
            typeof result === "object" &&
            "status" in result &&
            result.status === "not-applied"
          ) {
            return result as { status: "not-applied"; operationId: string };
          }
          return result as ApplyResult;
        }
        const log = await readApplyRecoveryLog(
          paths.operationsDir(rootKey),
          operationId
        );
        if (!log) {
          throw new ProjectSkillsApplyError(
            "indeterminate",
            "missing recovery log",
            operationId
          );
        }
        return await drive(ctx, log);
      });
    },
  };
}
