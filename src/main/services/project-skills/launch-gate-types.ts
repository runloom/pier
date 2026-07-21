import { createHash } from "node:crypto";
import type { AgentKind } from "../../../shared/contracts/agent.ts";
import type {
  ProjectRootRef as ContractProjectRootRef,
  DegradePolicy,
} from "../../../shared/contracts/project-skills.ts";
import type { SkillDiscoveryAdapterRegistry } from "./adapters.ts";
import type { ProjectSkillsIssue } from "./health.ts";
import {
  type ProjectRootRef as MainProjectRootRef,
  type StableProjectIdentity,
  toContractProjectRootRef,
} from "./identity.ts";
import type { EnsureReadyResult } from "./repair-service.ts";

/**
 * ManagedAgentLaunchGate types + pure helpers, split from launch-gate.ts
 * (file-size cap). Behavior unchanged.
 */

export type LaunchGateSurface =
  | {
      kind: "terminal";
      windowId?: string;
      panelId?: string;
    }
  | {
      kind: "one-shot";
      clientId?: string;
    };

export interface LaunchSpecification {
  command?: string | undefined;
  cwd?: string | undefined;
  env?: Readonly<Record<string, string>> | undefined;
  initialInput?: string | undefined;
}

export interface LaunchGateEnsureArgs {
  agentId: AgentKind | string;
  /** Optional pre-allocated attempt id (tests). */
  launchAttemptId?: string;
  launchSpecification?: LaunchSpecification;
  /**
   * Main-resolved project root only. Renderer createArgs.context must not be
   * treated as final authority — callers pass launch record / panel session /
   * main-resolved path here.
   */
  projectRef?: ContractProjectRootRef | MainProjectRootRef | null;
  projectRootPath?: string | null;
  surface?: LaunchGateSurface;
}

export interface LaunchSpawnFacts {
  agentId: AgentKind | string;
  launchSpecification?: LaunchSpecification;
  projectRef?: ContractProjectRootRef | MainProjectRootRef | null;
  projectRootPath?: string | null;
  surface: LaunchGateSurface;
}

export type LaunchGateResult =
  | { status: "ready"; launchAttemptId: string }
  | {
      status: "blocked";
      launchAttemptId: string;
      issueSummary: string[];
      degradePolicySummary: DegradePolicy;
      expiresAt: number;
      issues?: ProjectSkillsIssue[];
      /** Project root for the settings deep link (display only). */
      projectRootPath?: string;
    };

export type LaunchContinueDecision = "open-settings" | "degrade" | "cancel";

export type LaunchContinueResult =
  | {
      status: "ready";
      launchAttemptId: string;
      degraded: boolean;
    }
  | {
      status: "cancelled";
      launchAttemptId: string;
      decision: "open-settings" | "cancel";
    }
  | {
      status: "rejected";
      launchAttemptId: string;
      reason:
        | "unknown-attempt"
        | "expired"
        | "already-consumed"
        | "spawn-intent-no-replay"
        | "denied";
      message: string;
      gate?: LaunchGateResult;
    }
  | {
      status: "indeterminate";
      launchAttemptId: string;
      message: string;
    };

/** Continuation handshake result for spawn callers (design v8 §5.2.7). */
export type LaunchSpawnAuthorization =
  | { ok: true; launchAttemptId: string }
  | {
      ok: false;
      reason:
        | "unknown-attempt"
        | "not-authorized"
        | "launch-mismatch"
        | "spawn-intent-no-replay"
        | "already-consumed";
      message: string;
    };

export type ProjectSkillsEnsureReady = (args: {
  projectRef: ContractProjectRootRef | MainProjectRootRef;
  agentId: string;
  launchAttemptId: string;
}) => Promise<EnsureReadyResult>;

export interface ManagedAgentLaunchGate {
  /**
   * Continuation handshake: a retried spawn (terminal.create carrying the
   * attempt id) is admitted exactly while the attempt sits in the durable
   * SPAWN_INTENT authorization window — without re-gating and without a new
   * attempt. Any later retry is rejected (no replay).
   */
  authorizeSpawn(
    launchAttemptId: string,
    facts: LaunchSpawnFacts
  ): Promise<LaunchSpawnAuthorization>;
  continueLaunch(args: {
    launchAttemptId: string;
    decision: LaunchContinueDecision;
  }): Promise<LaunchContinueResult>;
  ensureReady(args: LaunchGateEnsureArgs): Promise<LaunchGateResult>;
  /** Test/diag: inspect in-memory attempt phase when present. */
  peekAttemptPhase?(launchAttemptId: string): Promise<string | null>;
  /** Record the actual spawn outcome after authorizeSpawn. */
  recordSpawnResult(launchAttemptId: string, ok: boolean): Promise<void>;
}

export interface CreateManagedAgentLaunchGateOptions {
  adapterRegistry?: SkillDiscoveryAdapterRegistry;
  attemptTtlMs?: number;
  createId?: () => string;
  ensureReady: ProjectSkillsEnsureReady;
  /** Whole-correction deadline (design §5.2.3); defaults to 10s. */
  ensureReadyTimeoutMs?: number;
  now?: () => number;
  userData: string;
}

export function issueLines(
  issues: readonly ProjectSkillsIssue[] | readonly string[]
): string[] {
  return issues.map((issue) => {
    if (typeof issue === "string") return issue;
    const skill = issue.skillId ? ` skill=${issue.skillId}` : "";
    const target = issue.relativeTarget
      ? ` target=${issue.relativeTarget}`
      : "";
    return `${issue.code}${skill}${target}`;
  });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Persists only a digest of process arguments. Environment values may contain
 * credentials, so the durable launch attempt must never serialize the spec.
 */
export function launchSpecificationFingerprint(
  specification: LaunchSpecification | undefined
): string {
  return `sha256:${createHash("sha256")
    .update("project-skills-launch-specification-v1\0", "utf8")
    .update(JSON.stringify(canonicalize(specification ?? {})), "utf8")
    .digest("hex")}`;
}

export function toIdentity(
  ref: ContractProjectRootRef | MainProjectRootRef
): StableProjectIdentity {
  if ("identity" in ref) {
    return ref.identity;
  }
  return {
    realPath: ref.realPath,
    volumeId: ref.volumeIdentity,
    directoryIdentity: ref.directoryIdentity,
  };
}

export function toContractRef(
  ref: ContractProjectRootRef | MainProjectRootRef
): ContractProjectRootRef {
  if ("identity" in ref) {
    return toContractProjectRootRef(ref.identity, ref.token);
  }
  return ref;
}

export function attemptFileName(launchAttemptId: string): string {
  return launchAttemptId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export const SPAWN_PHASE = {
  PENDING: "PENDING",
  SPAWN_INTENT: "SPAWN_INTENT",
  SPAWN_AUTHORIZED: "SPAWN_AUTHORIZED",
  SPAWN_ACCEPTED: "SPAWN_ACCEPTED",
  SPAWN_FAILED: "SPAWN_FAILED",
  CANCELLED: "CANCELLED",
} as const;

export type SpawnPhase = (typeof SPAWN_PHASE)[keyof typeof SPAWN_PHASE];

export interface PendingLaunchAttempt {
  agentId: string;
  createdAt: number;
  degraded: boolean;
  degradePolicySummary: DegradePolicy;
  expiresAt: number;
  issueCodes: string[];
  issueSummary: string[];
  launchAttemptId: string;
  launchSpecificationFingerprint: string;
  phase: SpawnPhase;
  projectIdentity: StableProjectIdentity;
  projectRef: ContractProjectRootRef;
  surface: LaunchGateSurface;
}
