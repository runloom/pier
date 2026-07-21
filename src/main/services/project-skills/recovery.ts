import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ApplyResult,
  ProjectRootRef as ContractProjectRootRef,
} from "../../../shared/contracts/project-skills.ts";
import {
  type CreateProjectSkillsApplyServiceOptions,
  createProjectSkillsApplyService,
  type ProjectSkillsApplyService,
} from "./apply-service.ts";
import {
  type ProjectRootRef as MainProjectRootRef,
  resolveStableProjectIdentity,
  type StableProjectIdentity,
} from "./identity.ts";
import type { ProjectSkillsLock } from "./lock.ts";
import { createProjectSkillsPaths } from "./paths.ts";
import {
  createProjectSkillsStore,
  type OperationRecord,
  type ProjectSkillsStore,
} from "./store.ts";

export type OperationStatusView =
  | {
      kind: "pending" | "recovering";
      operationId: string;
      phase: string;
      requestDigest: string;
    }
  | {
      kind: "terminal";
      operationId: string;
      status:
        | "converged"
        | "degraded"
        | "not-applied"
        | "superseded"
        | "recovery-blocked";
      requestDigest: string;
      result: unknown;
    }
  | {
      kind: "missing";
      operationId: string;
    };

export interface ProjectSkillsRecoveryCoordinator {
  /**
   * Read-only: never advances recovery. Returns pending/recovering for
   * in-flight ops and terminal results for finalized ones.
   */
  operationStatus(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    operationId: string
  ): Promise<OperationStatusView>;

  /**
   * Sole component that may advance an existing in-flight transaction without
   * a new write request. Replays from the durable recovery log.
   */
  recoverOperation(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    operationId: string
  ): Promise<
    | ApplyResult
    | {
        status: "not-applied" | "superseded" | "recovery-blocked";
        operationId: string;
        reason?: string;
      }
  >;

  /**
   * Bounded forward-drive of stranded in-flight operations (design §4.2.1 /
   * §5.2.2): crash and indeterminate leftovers converge on the next read
   * instead of waiting forever. Per-operation failures degrade to skipping —
   * never throws. Must be called OUTSIDE the project lock (recovery takes it).
   */
  sweepPendingOperations(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    opts?: { max?: number }
  ): Promise<{ advanced: number }>;
}

export interface CreateProjectSkillsRecoveryCoordinatorOptions {
  applyService?: ProjectSkillsApplyService;
  getObservedRevision?: CreateProjectSkillsApplyServiceOptions["getObservedRevision"];
  inspectGitState?: CreateProjectSkillsApplyServiceOptions["inspectGitState"];
  lock: ProjectSkillsLock;
  now?: () => number;
  /** Repair-log continuation (repair logs are not apply logs). */
  repairContinueFromLog?: (
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    operationId: string
  ) => Promise<unknown>;
  store?: ProjectSkillsStore;
  userData: string;
}

function toIdentity(
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

export function createProjectSkillsRecoveryCoordinator(
  options: CreateProjectSkillsRecoveryCoordinatorOptions
): ProjectSkillsRecoveryCoordinator {
  const paths = createProjectSkillsPaths(options.userData);
  const store =
    options.store ?? createProjectSkillsStore({ userData: options.userData });
  const applyService =
    options.applyService ??
    createProjectSkillsApplyService({
      userData: options.userData,
      lock: options.lock,
      store,
      ...(options.inspectGitState === undefined
        ? {}
        : { inspectGitState: options.inspectGitState }),
      ...(options.getObservedRevision === undefined
        ? {}
        : { getObservedRevision: options.getObservedRevision }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });

  async function resolveRootKey(
    projectRef: ContractProjectRootRef | MainProjectRootRef
  ): Promise<{ rootKey: string; identity: StableProjectIdentity }> {
    const claimed = toIdentity(projectRef);
    const live = await resolveStableProjectIdentity(claimed.realPath);
    return {
      identity: live,
      rootKey: paths.rootKeyFor(live),
    };
  }

  return {
    async operationStatus(projectRef, operationId) {
      const { rootKey } = await resolveRootKey(projectRef);
      let record: OperationRecord | null;
      try {
        record = await store.readOperation(rootKey, operationId);
      } catch {
        return { kind: "missing", operationId };
      }
      if (!record) {
        return { kind: "missing", operationId };
      }
      if (record.kind === "in-flight") {
        return {
          kind: "pending",
          operationId,
          phase: record.phase,
          requestDigest: record.requestDigest,
        };
      }
      return {
        kind: "terminal",
        operationId,
        status: record.status,
        requestDigest: record.requestDigest,
        result: record.result,
      };
    },

    async recoverOperation(projectRef, operationId) {
      const { rootKey } = await resolveRootKey(projectRef);
      const existing = await store.readOperation(rootKey, operationId);

      if (!existing) {
        return {
          status: "not-applied",
          operationId,
          reason: "operation-result-expired-or-missing",
        };
      }

      if (existing.kind === "terminal") {
        // Immutable terminal — never rewrite degraded → converged.
        const result = existing.result;
        if (
          result &&
          typeof result === "object" &&
          "status" in result &&
          typeof (result as { status: unknown }).status === "string"
        ) {
          const status = (result as { status: string }).status;
          if (
            status === "converged" ||
            status === "degraded" ||
            status === "indeterminate"
          ) {
            return result as ApplyResult;
          }
          if (
            status === "not-applied" ||
            status === "superseded" ||
            status === "recovery-blocked"
          ) {
            const reason =
              result &&
              typeof result === "object" &&
              "reason" in result &&
              typeof result.reason === "string"
                ? result.reason
                : undefined;
            return {
              status,
              operationId,
              ...(reason === undefined ? {} : { reason }),
            };
          }
        }
        if (
          existing.status === "not-applied" ||
          existing.status === "superseded" ||
          existing.status === "recovery-blocked"
        ) {
          return {
            status: existing.status,
            operationId,
          };
        }
        return {
          status: "recovery-blocked",
          operationId,
          reason: "terminal-result-unreadable",
        };
      }

      // in-flight: continue via the matching service (holds lock, drives SM).
      const recoveryPath = join(
        paths.operationsDir(rootKey),
        `${operationId}.recovery.json`
      );
      let logKind: unknown;
      try {
        const raw = await readFile(recoveryPath, "utf8");
        logKind = (JSON.parse(raw) as { kind?: unknown }).kind;
      } catch {
        logKind = undefined;
      }
      if (logKind === "repair") {
        if (!options.repairContinueFromLog) {
          throw new Error("repair continuation unavailable");
        }
        const continued = await options.repairContinueFromLog(
          projectRef,
          operationId
        );
        return continued as ApplyResult;
      }
      const continued = await applyService.continueFromLog(
        projectRef,
        operationId
      );
      if (continued.status === "not-applied") {
        return continued;
      }
      return continued;
    },

    async sweepPendingOperations(projectRef, opts) {
      const max = opts?.max ?? 3;
      let advanced = 0;
      let rootKey: string;
      try {
        ({ rootKey } = await resolveRootKey(projectRef));
      } catch {
        return { advanced };
      }
      let entries: string[] = [];
      try {
        entries = await readdir(paths.operationsDir(rootKey));
      } catch {
        return { advanced };
      }
      for (const entry of entries) {
        if (advanced >= max) break;
        if (!entry.endsWith(".recovery.json")) continue;
        const operationId = entry.slice(0, -".recovery.json".length);
        try {
          const record = await store.readOperation(rootKey, operationId);
          if (record?.kind !== "in-flight") continue;
          // Dispatch by durable log kind — repair logs are not apply logs.
          const raw = await readFile(
            join(paths.operationsDir(rootKey), entry),
            "utf8"
          );
          const logKind = (JSON.parse(raw) as { kind?: unknown }).kind;
          if (logKind === "repair") {
            if (options.repairContinueFromLog) {
              await options.repairContinueFromLog(projectRef, operationId);
              advanced += 1;
            }
            continue;
          }
          await applyService.continueFromLog(projectRef, operationId);
          advanced += 1;
        } catch {
          // Skip stragglers; the next sweep retries.
        }
      }
      return { advanced };
    },
  };
}
