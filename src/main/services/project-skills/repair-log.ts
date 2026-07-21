import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ProjectRootRef as ContractProjectRootRef,
  DegradePolicy,
  ProjectSkillsAcknowledgement,
  ProjectSkillsManifest,
} from "../../../shared/contracts/project-skills.ts";
import { projectSkillsManifestSchema } from "../../../shared/contracts/project-skills.ts";
import type {
  FsObjectIdentity,
  ProjectSkillsFileSystemAdapter,
} from "./fs-adapter.ts";
import type { ProjectSkillsIssue } from "./health.ts";
import type {
  ProjectRootRef as MainProjectRootRef,
  StableProjectIdentity,
} from "./identity.ts";
import type { createProjectSkillsPaths } from "./paths.ts";
import type {
  GitFiveState,
  PlanConfirmationRequirement,
  PlanTargetOperation,
} from "./plan.ts";
import type { OwnershipTarget, ProjectSkillsStore } from "./store.ts";

export type RepairTransactionPhase =
  | "PREPARED"
  | "MANIFEST_CONFIRMED"
  | "RECONCILING_TARGETS"
  | "OWNERSHIP_COMMITTED"
  | "FINALIZED";

const PHASE_ORDER: readonly RepairTransactionPhase[] = [
  "PREPARED",
  "MANIFEST_CONFIRMED",
  "RECONCILING_TARGETS",
  "OWNERSHIP_COMMITTED",
  "FINALIZED",
] as const;

export interface ProjectSkillsRepairPlan {
  blockingIssues: ProjectSkillsIssue[];
  confirmationRequirements: PlanConfirmationRequirement[];
  continuationOf?: string;
  executable: boolean;
  observedRevision: string;
  repairPlanDigest: string;
  /** True when only safe auto-fix ops remain (no new confirmations). */
  safeAutoFixable: boolean;
  targetOperations: PlanTargetOperation[];
}

export type ReconcileResult =
  | {
      status: "converged";
      operationId: string;
      revisions: { manifestRevision: string; observedRevision: string };
      targetResults: unknown[];
      snapshot: unknown;
    }
  | {
      status: "degraded";
      operationId: string;
      revisions: { manifestRevision: string; observedRevision: string };
      targetResults: unknown[];
      snapshot: unknown;
      pendingIssueIds: string[];
    }
  | {
      status: "indeterminate";
      operationId: string;
      lastConfirmedObservedRevision: string;
      manifestRevision?: string;
      operationStatusQuery: {
        projectRef: ContractProjectRootRef;
        operationId: string;
      };
    }
  | {
      status: "superseded";
      operationId: string;
      hadDurableTargetChanges: true;
      baselineObservedRevision: string;
      currentObservedRevision: string;
      snapshot: unknown;
      targetResults: unknown[];
    }
  | {
      status: "not-applied";
      operationId: string;
      reason?: string;
    };

/**
 * v8: blocked attempts are one-shot handles keyed by launchAttemptId — the
 * v7 opaque challenge ceremony was removed (design §5.2).
 */
export type EnsureReadyResult =
  | { status: "ready"; launchAttemptId: string; repaired: boolean }
  | {
      status: "blocked";
      launchAttemptId: string;
      issueSummary: ProjectSkillsIssue[];
      degradePolicySummary: DegradePolicy;
      expiresAt: number;
    };

export interface RepairRequest {
  acknowledgements: readonly ProjectSkillsAcknowledgement[];
  continuationOf?: string;
  observedRevision: string;
  operationId: string;
  projectRef: ContractProjectRootRef | MainProjectRootRef;
  repairPlanDigest: string;
}

export class ProjectSkillsRepairError extends Error {
  readonly code:
    | "not-applied"
    | "plan-stale"
    | "revision-conflict"
    | "operation-conflict"
    | "acknowledgement-required"
    | "indeterminate";
  readonly operationId: string;

  constructor(
    code: ProjectSkillsRepairError["code"],
    message: string,
    operationId: string
  ) {
    super(message);
    this.name = "ProjectSkillsRepairError";
    this.code = code;
    this.operationId = operationId;
  }
}

export interface TargetOpResult {
  kind: PlanTargetOperation["kind"];
  reason?: string;
  relativeTarget: string;
  skillId: string;
  status: "created" | "deleted" | "noop" | "failed";
}

export interface RepairRecoveryLog {
  acknowledgements: ProjectSkillsAcknowledgement[];
  continuationOf?: string;
  finalizedResult?: ReconcileResult;
  hadDurableTargetChanges: boolean;
  kind: "repair";
  manifestDigest: string | null;
  manifestPresent: boolean;
  manifestRevision: string | null;
  observedRevision: string;
  operationId: string;
  ownershipCommitted: boolean;
  ownershipTargets: OwnershipTarget[];
  pendingIssueIds: string[];
  phase: RepairTransactionPhase;
  plan: ProjectSkillsRepairPlan;
  projectIdentity: StableProjectIdentity;
  repairPlanDigest: string;
  requestDigest: string;
  rootKey: string;
  schemaVersion: 1;
  targetResults: TargetOpResult[];
}

/** Shared dependencies threaded through the repair modules. */
export interface RepairContext {
  fs: ProjectSkillsFileSystemAdapter;
  getObservedRevision: (projectRoot: string) => Promise<string>;
  inspectGitState: (
    relativeTarget: string,
    projectRoot: string
  ) => Promise<GitFiveState>;
  now: () => number;
  onInvalidated?: (event: {
    projectIdentity: string;
    observedRevision: string;
  }) => void;
  paths: ReturnType<typeof createProjectSkillsPaths>;
  store: ProjectSkillsStore;
}

export function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
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

function sha256Domain(domain: string, payload: unknown): string {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(canonicalJson(payload), "utf8")
    .digest("hex")}`;
}

function digestBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function phaseIndex(phase: RepairTransactionPhase): number {
  return PHASE_ORDER.indexOf(phase);
}

export function isPhaseAtLeast(
  current: RepairTransactionPhase,
  target: RepairTransactionPhase
): boolean {
  return phaseIndex(current) >= phaseIndex(target);
}

export function sameIdentity(
  left: FsObjectIdentity,
  right: FsObjectIdentity
): boolean {
  if (
    left.dev !== right.dev ||
    left.ino !== right.ino ||
    left.mode !== right.mode ||
    left.isDirectory !== right.isDirectory ||
    left.isSymbolicLink !== right.isSymbolicLink
  ) {
    return false;
  }
  if (!left.isDirectory && left.nlink !== right.nlink) {
    return false;
  }
  if (left.birthtimeNs === undefined || right.birthtimeNs === undefined) {
    return true;
  }
  return left.birthtimeNs === right.birthtimeNs;
}

export function ownershipIdentityForStore(
  id: FsObjectIdentity
): FsObjectIdentity {
  return {
    dev: id.dev,
    ino: id.ino,
    mode: id.mode,
    nlink: id.nlink,
    isDirectory: id.isDirectory,
    isSymbolicLink: id.isSymbolicLink,
  };
}

function identityToJson(id: FsObjectIdentity): Record<string, unknown> {
  const json: Record<string, unknown> = {
    dev: id.dev,
    ino: id.ino,
    mode: id.mode,
    nlink: id.nlink,
    isDirectory: id.isDirectory,
    isSymbolicLink: id.isSymbolicLink,
  };
  if (id.birthtimeNs !== undefined) {
    json.birthtimeNs = id.birthtimeNs.toString();
  }
  return json;
}

function identityFromJson(value: unknown): FsObjectIdentity | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.dev !== "number" ||
    typeof v.ino !== "number" ||
    typeof v.mode !== "number" ||
    typeof v.nlink !== "number" ||
    typeof v.isDirectory !== "boolean" ||
    typeof v.isSymbolicLink !== "boolean"
  ) {
    return null;
  }
  const identity: FsObjectIdentity = {
    dev: v.dev,
    ino: v.ino,
    mode: v.mode,
    nlink: v.nlink,
    isDirectory: v.isDirectory,
    isSymbolicLink: v.isSymbolicLink,
  };
  if (typeof v.birthtimeNs === "string") {
    identity.birthtimeNs = BigInt(v.birthtimeNs);
  }
  return identity;
}

function serializeRepairLog(log: RepairRecoveryLog): unknown {
  return {
    ...log,
    ownershipTargets: log.ownershipTargets.map((t) => ({
      ...t,
      objectIdentity: identityToJson(t.objectIdentity),
    })),
  };
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export function repairLogPath(
  operationsDir: string,
  operationId: string
): string {
  return join(operationsDir, `${operationId}.repair.json`);
}

export async function readRepairRecoveryLog(
  operationsDir: string,
  operationId: string
): Promise<RepairRecoveryLog | null> {
  try {
    const raw = await readFile(
      repairLogPath(operationsDir, operationId),
      "utf8"
    );
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as RepairRecoveryLog & {
      ownershipTargets?: Array<OwnershipTarget & { objectIdentity: unknown }>;
    };
    if (record.kind !== "repair" || record.schemaVersion !== 1) return null;
    if (Array.isArray(record.ownershipTargets)) {
      record.ownershipTargets = record.ownershipTargets.map((t) => {
        const identity = identityFromJson(t.objectIdentity);
        return {
          ...t,
          objectIdentity:
            identity ??
            ownershipIdentityForStore({
              dev: 0,
              ino: 0,
              mode: 0,
              nlink: 0,
              isDirectory: false,
              isSymbolicLink: true,
            }),
        };
      });
    }
    return record;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return null;
    throw error;
  }
}

export async function writeRepairRecoveryLog(
  operationsDir: string,
  log: RepairRecoveryLog
): Promise<void> {
  await writeJsonAtomic(
    repairLogPath(operationsDir, log.operationId),
    serializeRepairLog(log)
  );
}

export function computeRepairPlanDigest(input: {
  observedRevision: string;
  continuationOf?: string;
  targetOperations: PlanTargetOperation[];
  confirmationRequirements: PlanConfirmationRequirement[];
}): string {
  const ops = [...input.targetOperations].sort((a, b) =>
    a.relativeTarget.localeCompare(b.relativeTarget)
  );
  const conf = [...input.confirmationRequirements].sort((a, b) =>
    a.id.localeCompare(b.id)
  );
  return sha256Domain("project-skills-repair-plan-v1", {
    observedRevision: input.observedRevision,
    continuationOf: input.continuationOf ?? null,
    targetOperations: ops,
    confirmationRequirements: conf,
  });
}

export function computeRepairRequestDigest(input: {
  operationId: string;
  repairPlanDigest: string;
  observedRevision: string;
  acknowledgements: readonly ProjectSkillsAcknowledgement[];
  continuationOf?: string;
}): string {
  const acks = [...input.acknowledgements]
    .map((a) => ({
      requirementId: a.requirementId,
      nonce: a.nonce,
      expectedActualTreeDigest: a.expectedActualTreeDigest ?? null,
    }))
    .sort((a, b) => a.requirementId.localeCompare(b.requirementId));
  return sha256Domain("project-skills-repair-request-v1", {
    operationId: input.operationId,
    repairPlanDigest: input.repairPlanDigest,
    observedRevision: input.observedRevision,
    continuationOf: input.continuationOf ?? null,
    acknowledgements: acks,
  });
}

export type ManifestRead =
  | { status: "absent" }
  | { status: "invalid"; reason: string }
  | {
      status: "present";
      manifest: ProjectSkillsManifest;
      digest: string;
      revision: string;
    };

export async function readManifestState(
  projectRoot: string
): Promise<ManifestRead> {
  const path = join(projectRoot, ".pier", "skills", "manifest.json");
  try {
    const bytes = await readFile(path);
    const digest = digestBytes(bytes);
    let json: unknown;
    try {
      json = JSON.parse(bytes.toString("utf8"));
    } catch {
      return { status: "invalid", reason: "manifest-json-parse-failed" };
    }
    const parsed = projectSkillsManifestSchema.safeParse(json);
    if (!parsed.success) {
      return { status: "invalid", reason: "manifest-schema-invalid" };
    }
    return {
      status: "present",
      manifest: parsed.data,
      digest,
      revision: digest,
    };
  } catch (error) {
    if (isErrno(error, "ENOENT")) return { status: "absent" };
    return {
      status: "invalid",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function projectIdentityKey(identity: StableProjectIdentity): string {
  return `${identity.volumeId}:${identity.directoryIdentity}`;
}
