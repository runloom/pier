import { randomUUID } from "node:crypto";
import type { AgentKind } from "../../../../shared/contracts/agent.ts";
import type { ProjectRootRef as ContractProjectRootRef } from "../../../../shared/contracts/project-skills.ts";
import { createSkillDiscoveryAdapterRegistry } from "../adapters.ts";
import {
  resolveStableProjectIdentity,
  toContractProjectRootRef,
} from "../identity.ts";
import { createProjectSkillsPaths } from "../paths.ts";
import type { EnsureReadyResult } from "../repair/service.ts";
import {
  createLaunchAttemptStore,
  EnsureReadyTimeout,
  withTimeout,
} from "./attempt-store.ts";
import { continueLaunch as continueLaunchImpl } from "./continue.ts";

/**
 * Managed agent launch skills hook: best-effort projection before spawn.
 * Never refuses opening an agent — skills hygiene is settings-only.
 * Durable SPAWN_INTENT at-most-once machinery is retained for crash safety
 * on explicit continuation handshakes (legacy degrade path).
 */

/** Whole-correction deadline: abandon skills repair, still open the agent. */
const ENSURE_READY_TIMEOUT_MS = 10_000;

export type {
  CreateManagedAgentLaunchGateOptions,
  LaunchContinueDecision,
  LaunchContinueResult,
  LaunchGateEnsureArgs,
  LaunchGateResult,
  LaunchGateSurface,
  LaunchSpawnAuthorization,
  LaunchSpawnFacts,
  LaunchSpecification,
  ManagedAgentLaunchGate,
  ProjectSkillsEnsureReady,
} from "./types.ts";

import {
  type CreateManagedAgentLaunchGateOptions,
  issueLines,
  type LaunchContinueDecision,
  type LaunchContinueResult,
  type LaunchGateEnsureArgs,
  type LaunchGateResult,
  type LaunchGateSurface,
  type LaunchSpawnAuthorization,
  type LaunchSpawnFacts,
  launchSpecificationFingerprint,
  type ManagedAgentLaunchGate,
  type PendingLaunchAttempt,
  SPAWN_PHASE,
  toContractRef,
  toIdentity,
} from "./types.ts";

export function createManagedAgentLaunchGate(
  options: CreateManagedAgentLaunchGateOptions
): ManagedAgentLaunchGate {
  const now = options.now ?? Date.now;
  const createId = options.createId ?? randomUUID;
  const ensureReadyTimeoutMs =
    options.ensureReadyTimeoutMs ?? ENSURE_READY_TIMEOUT_MS;
  const adapters =
    options.adapterRegistry ?? createSkillDiscoveryAdapterRegistry();
  const paths = createProjectSkillsPaths(options.userData);
  const pending = new Map<string, PendingLaunchAttempt>();
  const authorizationTails = new Map<string, Promise<void>>();
  const { loadDurableAttempt, persistAttempt, sweepAttemptFiles } =
    createLaunchAttemptStore({ paths, now });

  function sweepMemory(): void {
    const t = now();
    for (const [id, record] of pending) {
      // SPAWN_INTENT diagnostics are retained (design §5.2).
      if (
        record.phase === SPAWN_PHASE.SPAWN_INTENT ||
        record.phase === SPAWN_PHASE.SPAWN_AUTHORIZED
      )
        continue;
      if (record.phase === SPAWN_PHASE.PENDING && t > record.expiresAt) {
        pending.delete(id);
      }
    }
  }

  async function withAuthorizationLock<T>(
    launchAttemptId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous =
      authorizationTails.get(launchAttemptId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    authorizationTails.set(launchAttemptId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      if (authorizationTails.get(launchAttemptId) === tail) {
        authorizationTails.delete(launchAttemptId);
      }
      release();
    }
  }

  function sameLaunchSurface(
    left: LaunchGateSurface,
    right: LaunchGateSurface
  ): boolean {
    if (left.kind !== right.kind) return false;
    if (left.kind === "terminal" && right.kind === "terminal") {
      return left.panelId === right.panelId && left.windowId === right.windowId;
    }
    if (left.kind === "one-shot" && right.kind === "one-shot") {
      return left.clientId === right.clientId;
    }
    return false;
  }

  function blockedFromEnsure(
    result: Extract<EnsureReadyResult, { status: "blocked" }>,
    launchAttemptId: string,
    projectRootPath: string
  ): LaunchGateResult {
    return {
      status: "blocked",
      launchAttemptId,
      issueSummary: issueLines(result.issueSummary),
      degradePolicySummary: result.degradePolicySummary,
      expiresAt: result.expiresAt,
      issues: [...result.issueSummary],
      projectRootPath,
    };
  }

  async function resolveProjectRef(
    args: LaunchGateEnsureArgs
  ): Promise<ContractProjectRootRef | null> {
    if (args.projectRef) {
      const claimed = toIdentity(args.projectRef);
      try {
        const live = await resolveStableProjectIdentity(claimed.realPath);
        if (
          live.volumeId !== claimed.volumeId ||
          live.directoryIdentity !== claimed.directoryIdentity
        ) {
          return toContractProjectRootRef(live);
        }
        return toContractRef(args.projectRef);
      } catch {
        return toContractRef(args.projectRef);
      }
    }
    const path = args.projectRootPath?.trim();
    if (!path) return null;
    try {
      const identity = await resolveStableProjectIdentity(path);
      return toContractProjectRootRef(identity);
    } catch {
      return null;
    }
  }

  async function ensureReady(
    args: LaunchGateEnsureArgs
  ): Promise<LaunchGateResult> {
    sweepMemory();
    const launchAttemptId = args.launchAttemptId ?? createId();
    const agentId = String(args.agentId);

    // Only adapters that consume project skill projections participate.
    if (!adapters.isApplicable(agentId as AgentKind)) {
      return { status: "ready", launchAttemptId };
    }

    const projectRef = await resolveProjectRef(args);
    if (!projectRef) {
      // No project cwd → not a project-skills managed launch.
      return { status: "ready", launchAttemptId };
    }

    if (
      options.isPierHomeRoot &&
      (await options.isPierHomeRoot(toIdentity(projectRef).realPath))
    ) {
      // Pier Home is an agent cwd for rules/canvases, not a skills project.
      return { status: "ready", launchAttemptId };
    }

    sweepAttemptFiles(paths.rootKeyFor(toIdentity(projectRef))).catch(
      () => undefined
    );

    // Best-effort skills projection only. Opening an agent is never a skills
    // hygiene decision: timeout / lock-busy / residual issues must not prompt
    // or refuse spawn — the agent session does not depend on skills readiness.
    let ensure: EnsureReadyResult;
    try {
      ensure = await withTimeout(
        options.ensureReady({ projectRef, agentId, launchAttemptId }),
        ensureReadyTimeoutMs
      );
    } catch (error) {
      if (
        error instanceof EnsureReadyTimeout ||
        (error instanceof Error && error.name === "ProjectSkillsLockBusy")
      ) {
        return { status: "ready", launchAttemptId };
      }
      throw error;
    }

    // ensureReady is always-ready by contract; tolerate a blocked result from
    // older injectors without surfacing a launch dialog.
    if (ensure.status !== "ready") {
      return { status: "ready", launchAttemptId: ensure.launchAttemptId };
    }
    return { status: "ready", launchAttemptId: ensure.launchAttemptId };
  }

  async function continueLaunch(args: {
    launchAttemptId: string;
    decision: LaunchContinueDecision;
  }): Promise<LaunchContinueResult> {
    return await continueLaunchImpl(
      {
        blockedFromEnsure,
        ensureReady: options.ensureReady,
        ensureReadyTimeoutMs,
        loadDurableAttempt,
        now,
        pending,
        persistAttempt,
        sweepMemory,
      },
      args
    );
  }

  async function authorizeSpawn(
    launchAttemptId: string,
    facts: LaunchSpawnFacts
  ): Promise<LaunchSpawnAuthorization> {
    return withAuthorizationLock(launchAttemptId, async () => {
      let record = pending.get(launchAttemptId) ?? null;
      if (!record) {
        return {
          ok: false,
          reason: "unknown-attempt",
          message: "launch attempt not found",
        };
      }
      const durable = await loadDurableAttempt(
        record.projectIdentity,
        launchAttemptId
      );
      if (durable) {
        record = durable;
        pending.set(launchAttemptId, durable);
      }
      if (record.phase === SPAWN_PHASE.SPAWN_INTENT) {
        const currentProjectRef = await resolveProjectRef(facts);
        const currentIdentity = currentProjectRef
          ? toIdentity(currentProjectRef)
          : null;
        const sameProject =
          currentIdentity !== null &&
          currentIdentity.realPath === record.projectIdentity.realPath &&
          currentIdentity.volumeId === record.projectIdentity.volumeId &&
          currentIdentity.directoryIdentity ===
            record.projectIdentity.directoryIdentity;
        const sameSurface = sameLaunchSurface(facts.surface, record.surface);
        const sameSpecification =
          launchSpecificationFingerprint(facts.launchSpecification) ===
          record.launchSpecificationFingerprint;
        if (
          String(facts.agentId) !== record.agentId ||
          !sameProject ||
          !sameSurface ||
          !sameSpecification
        ) {
          return {
            ok: false,
            reason: "launch-mismatch",
            message: "launch continuation does not match the authorized launch",
          };
        }
        const consumed: PendingLaunchAttempt = {
          ...record,
          phase: SPAWN_PHASE.SPAWN_AUTHORIZED,
        };
        pending.set(launchAttemptId, consumed);
        await persistAttempt(consumed);
        return { ok: true, launchAttemptId };
      }
      if (
        record.phase === SPAWN_PHASE.SPAWN_AUTHORIZED ||
        record.phase === SPAWN_PHASE.SPAWN_ACCEPTED ||
        record.phase === SPAWN_PHASE.SPAWN_FAILED
      ) {
        return {
          ok: false,
          reason: "spawn-intent-no-replay",
          message: `launch attempt already ${record.phase.toLowerCase()}`,
        };
      }
      if (record.phase === SPAWN_PHASE.CANCELLED) {
        return {
          ok: false,
          reason: "already-consumed",
          message: "launch attempt was cancelled",
        };
      }
      return {
        ok: false,
        reason: "not-authorized",
        message: "launch attempt has no spawn authorization",
      };
    });
  }

  async function recordSpawnResult(
    launchAttemptId: string,
    ok: boolean
  ): Promise<void> {
    const record = pending.get(launchAttemptId);
    if (!record || record.phase !== SPAWN_PHASE.SPAWN_AUTHORIZED) return;
    const next: PendingLaunchAttempt = {
      ...record,
      phase: ok ? SPAWN_PHASE.SPAWN_ACCEPTED : SPAWN_PHASE.SPAWN_FAILED,
    };
    pending.set(launchAttemptId, next);
    await persistAttempt(next);
    if (ok) {
      pending.delete(launchAttemptId);
    }
  }

  return {
    ensureReady,
    continueLaunch,
    authorizeSpawn,
    recordSpawnResult,
    async peekAttemptPhase(launchAttemptId) {
      return pending.get(launchAttemptId)?.phase ?? null;
    },
  };
}
