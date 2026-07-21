import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import writeFileAtomic from "write-file-atomic";
import type {
  ApplyResult,
  ProjectRootRef as ContractProjectRootRef,
  ProjectSkillsAcknowledgement,
  ProjectSkillsDraft,
  ProjectSkillsManifest,
} from "../../../shared/contracts/project-skills.ts";
import type {
  FsObjectIdentity,
  ProjectSkillsFileSystemAdapter,
} from "./fs-adapter.ts";
import type {
  ProjectRootRef as MainProjectRootRef,
  StableProjectIdentity,
} from "./identity.ts";
import type { createProjectSkillsPaths } from "./paths.ts";
import {
  normalizeProjectSkillsDraft,
  type PlanTargetOperation,
  type ProjectSkillsPlan,
  type ProjectSkillsPlanService,
} from "./plan.ts";
import type { OwnershipTarget, ProjectSkillsStore } from "./store.ts";

export type ApplyTransactionPhase =
  | "PREPARED"
  | "CONTENT_PUBLISHED"
  | "MANIFEST_COMMITTED"
  | "RECONCILING_TARGETS"
  | "OWNERSHIP_COMMITTED"
  | "FINALIZED";

const PHASE_ORDER: readonly ApplyTransactionPhase[] = [
  "PREPARED",
  "CONTENT_PUBLISHED",
  "MANIFEST_COMMITTED",
  "RECONCILING_TARGETS",
  "OWNERSHIP_COMMITTED",
  "FINALIZED",
] as const;

export interface CleanupEntryExpectation {
  identity: FsObjectIdentity;
  kind: "file" | "directory";
  relativePath: string;
}

export interface ApplyHookContext {
  operationId: string;
  phase: ApplyTransactionPhase;
  projectRoot: string;
  rootKey: string;
}

export interface ApplyHooks {
  afterLibraryPublishLogged?: (ctx: ApplyHookContext) => Promise<void>;
  afterPhase?: (
    phase: ApplyTransactionPhase,
    ctx: ApplyHookContext
  ) => Promise<void>;
  afterReplacementRestored?: (ctx: ApplyHookContext) => Promise<void>;
  afterRollbackIntent?: (ctx: ApplyHookContext) => Promise<void>;
  beforeCommittedBackupCleanup?: (ctx: ApplyHookContext) => Promise<void>;
  beforePhase?: (
    phase: ApplyTransactionPhase,
    ctx: ApplyHookContext
  ) => Promise<void>;
}

export interface ApplyRequest {
  acknowledgements: readonly ProjectSkillsAcknowledgement[];
  draft: ProjectSkillsDraft;
  observedRevision: string;
  operationId: string;
  planDigest: string;
  projectRef: ContractProjectRootRef | MainProjectRootRef;
}

export class ProjectSkillsApplyError extends Error {
  readonly code:
    | "not-applied"
    | "plan-stale"
    | "revision-conflict"
    | "operation-conflict"
    | "acknowledgement-required"
    | "content-conflict"
    | "token-expired"
    | "indeterminate";
  readonly operationId: string;

  constructor(
    code: ProjectSkillsApplyError["code"],
    message: string,
    operationId: string
  ) {
    super(message);
    this.name = "ProjectSkillsApplyError";
    this.code = code;
    this.operationId = operationId;
  }
}

export interface LibraryPublishRecord {
  backupPath?: string;
  entries: CleanupEntryExpectation[];
  fromImportToken?: string;
  libraryPath: string;
  replacedEntries?: CleanupEntryExpectation[];
  rootIdentity: FsObjectIdentity;
  skillId: string;
}

export interface GitDeleteAckRecord {
  expectedRelativeLinkTarget: string;
  nonce: string;
  objectIdentity: FsObjectIdentity | null;
  relativeTarget: string;
  skillId: string;
}

export interface TargetOpResult {
  kind: PlanTargetOperation["kind"];
  reason?: string;
  relativeTarget: string;
  skillId: string;
  status: "created" | "deleted" | "noop" | "failed" | "skipped";
}

/** Durable recovery payload (separate from OperationRecord phase marker). */
export interface ApplyRecoveryLog {
  acknowledgements: ProjectSkillsAcknowledgement[];
  claimedTokens: string[];
  cleanupPlans: Array<{
    skillId: string;
    libraryDir: string;
    entries: CleanupEntryExpectation[];
  }>;
  draft: ProjectSkillsDraft;
  /** Serialized identity fields for JSON (bigint → string). */
  finalizedResult?:
    | ApplyResult
    | { status: "not-applied"; operationId: string; reason?: string };
  gitDeleteAcks: GitDeleteAckRecord[];
  kind: "apply";
  manifestCommitted: boolean;
  manifestRevision: string | null;
  nextManifest: ProjectSkillsManifest;
  observedRevision: string;
  operationId: string;
  ownershipCommitted: boolean;
  ownershipTargets: OwnershipTarget[];
  pendingIssueIds: string[];
  /**
   * In-flight library replaces (content-update / drift-accept): old-tree
   * identity recorded BEFORE cleanup so crash recovery can finish (§4.3.3).
   * Cleared once the new tree is published into `publishedLibrary`.
   */
  pendingLibraryReplaces: Array<{
    backupPath: string;
    skillId: string;
    libraryPath: string;
    entries: CleanupEntryExpectation[];
    replacementDigest: string;
    tempDir: string;
  }>;
  phase: ApplyTransactionPhase;
  plan: ProjectSkillsPlan;
  planDigest: string;
  previousManifestDigest: string | null;
  previousManifestIdentity: FsObjectIdentity | null;
  previousManifestPresent: boolean;
  projectIdentity: StableProjectIdentity;
  publishedLibrary: LibraryPublishRecord[];
  requestDigest: string;
  rollbackIntent: { reason: string; startedAt: number } | null;
  rootKey: string;
  schemaVersion: 1;
  targetResults: TargetOpResult[];
}

/** Shared dependencies threaded through the apply phase executors. */
export interface ApplyCtx {
  fs: ProjectSkillsFileSystemAdapter;
  getObservedRevision: (projectRoot: string) => Promise<string>;
  hooks: ApplyHooks | undefined;
  now: () => number;
  paths: ReturnType<typeof createProjectSkillsPaths>;
  planService: ProjectSkillsPlanService;
  resolveStagingTreePath: (rootKey: string, token: string) => string | null;
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

export function computeApplyRequestDigest(input: {
  operationId: string;
  planDigest: string;
  observedRevision: string;
  draft: ProjectSkillsDraft;
  acknowledgements: readonly ProjectSkillsAcknowledgement[];
}): string {
  const normalized = normalizeProjectSkillsDraft(input.draft);
  const acks = [...input.acknowledgements]
    .map((a) => ({
      requirementId: a.requirementId,
      nonce: a.nonce,
      expectedActualTreeDigest: a.expectedActualTreeDigest ?? null,
    }))
    .sort((a, b) => a.requirementId.localeCompare(b.requirementId));
  return sha256Domain("project-skills-apply-request-v1", {
    operationId: input.operationId,
    planDigest: input.planDigest,
    observedRevision: input.observedRevision,
    normalizedDraft: normalized,
    acknowledgements: acks,
  });
}

export function digestBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
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
  // Directory nlink changes as children are added/removed; it is not a stable
  // object-identity field for cleanup matching. Files/symlinks still check nlink.
  if (!left.isDirectory && left.nlink !== right.nlink) {
    return false;
  }
  if (left.birthtimeNs === undefined || right.birthtimeNs === undefined) {
    return true;
  }
  return left.birthtimeNs === right.birthtimeNs;
}

/** Ownership ledger JSON cannot carry bigint; drop birthtimeNs on write. */
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

export function identityToJson(id: FsObjectIdentity): Record<string, unknown> {
  return {
    dev: id.dev,
    ino: id.ino,
    mode: id.mode,
    nlink: id.nlink,
    isDirectory: id.isDirectory,
    isSymbolicLink: id.isSymbolicLink,
    ...(id.birthtimeNs === undefined
      ? {}
      : { birthtimeNs: id.birthtimeNs.toString() }),
  };
}

export function identityFromJson(value: unknown): FsObjectIdentity | null {
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
  return {
    dev: v.dev,
    ino: v.ino,
    mode: v.mode,
    nlink: v.nlink,
    isDirectory: v.isDirectory,
    isSymbolicLink: v.isSymbolicLink,
    ...(typeof v.birthtimeNs === "string"
      ? { birthtimeNs: BigInt(v.birthtimeNs) }
      : {}),
  };
}

function phaseIndex(phase: ApplyTransactionPhase): number {
  return PHASE_ORDER.indexOf(phase);
}

export function isPhaseAtLeast(
  current: ApplyTransactionPhase,
  target: ApplyTransactionPhase
): boolean {
  return phaseIndex(current) >= phaseIndex(target);
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function writeJsonAtomic(
  path: string,
  value: unknown
): Promise<void> {
  await ensureDir(dirname(path));
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
}
