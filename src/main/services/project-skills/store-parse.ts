import { lstat, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { ProjectSkillsGenerationConflict } from "./store-errors.ts";
import type {
  OperationRecord,
  OwnershipRecord,
  StagingCandidateRecord,
} from "./store-types.ts";

/**
 * Ledger JSON parsing + small durable-write helpers, split from store.ts
 * (file-size cap). Behavior unchanged.
 */

export interface CorruptTombstone {
  createdAt: number;
  kind: "ownership" | "operation";
  originalIdentity?: {
    dev: number;
    ino: number;
    mode: number;
    nlink: number;
  };
  originalPath: string;
  plannedQuarantinePath: string;
  rootKey: string;
  schemaVersion: 1;
  state: "PREPARED" | "QUARANTINED";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

export function isMissingPathError(error: unknown): boolean {
  return isErrno(error, "ENOENT");
}

export async function defaultRenameExclusive(
  source: string,
  target: string
): Promise<void> {
  try {
    await lstat(target);
    const error = new Error(
      `EEXIST: file already exists, rename '${source}' -> '${target}'`
    ) as NodeJS.ErrnoException;
    error.code = "EEXIST";
    throw error;
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }
  await rename(source, target);
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

export function stableProjectIdentitySchemaOk(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.realPath === "string" &&
    typeof value.volumeId === "string" &&
    typeof value.directoryIdentity === "string"
  );
}

export function parseOwnership(value: unknown): OwnershipRecord | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== 1) return null;
  if (
    typeof value.generation !== "number" ||
    !Number.isInteger(value.generation)
  ) {
    return null;
  }
  if (value.generation < 1) return null;
  if (!stableProjectIdentitySchemaOk(value.projectIdentity)) return null;
  if (!Array.isArray(value.targets)) return null;
  return value as unknown as OwnershipRecord;
}

export function parseOperation(value: unknown): OperationRecord | null {
  if (!isRecord(value)) return null;
  if (value.kind === "in-flight") {
    if (
      typeof value.phase !== "string" ||
      typeof value.requestDigest !== "string"
    ) {
      return null;
    }
    return {
      kind: "in-flight",
      phase: value.phase,
      requestDigest: value.requestDigest,
    };
  }
  if (value.kind === "terminal") {
    const status = value.status;
    if (
      status !== "converged" &&
      status !== "degraded" &&
      status !== "not-applied" &&
      status !== "superseded" &&
      status !== "recovery-blocked"
    ) {
      return null;
    }
    if (typeof value.requestDigest !== "string") return null;
    return {
      kind: "terminal",
      status,
      requestDigest: value.requestDigest,
      result: value.result,
    };
  }
  return null;
}

export function parseStaging(value: unknown): StagingCandidateRecord | null {
  if (!isRecord(value)) return null;
  if (typeof value.token !== "string" || value.token.length < 16) return null;
  if (
    value.state !== "AVAILABLE" &&
    value.state !== "CLAIMED" &&
    value.state !== "CONSUMED" &&
    value.state !== "RELEASED"
  ) {
    return null;
  }
  if (typeof value.skillId !== "string") return null;
  if (
    value.sourceKind !== "local-import" &&
    value.sourceKind !== "project-discovery-import" &&
    value.sourceKind !== "git-declared" &&
    value.sourceKind !== "content-update" &&
    value.sourceKind !== "drift-accepted"
  ) {
    return null;
  }
  if (typeof value.contentDigest !== "string") return null;
  if (typeof value.treeDigest !== "string") return null;
  if (typeof value.expiresAt !== "number") return null;
  if (typeof value.createdAt !== "number") return null;
  if (
    value.operationId !== undefined &&
    typeof value.operationId !== "string"
  ) {
    return null;
  }
  if (
    value.baseSkillId !== undefined &&
    typeof value.baseSkillId !== "string"
  ) {
    return null;
  }
  if (
    value.baseContentDigest !== undefined &&
    typeof value.baseContentDigest !== "string"
  ) {
    return null;
  }
  // Content updates must carry their base preconditions.
  if (
    value.sourceKind === "content-update" &&
    (typeof value.baseSkillId !== "string" ||
      typeof value.baseContentDigest !== "string")
  ) {
    return null;
  }
  return value as unknown as StagingCandidateRecord;
}

export function parseTombstone(value: unknown): CorruptTombstone | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== 1) return null;
  if (value.state !== "PREPARED" && value.state !== "QUARANTINED") return null;
  if (typeof value.rootKey !== "string") return null;
  if (typeof value.originalPath !== "string") return null;
  if (typeof value.plannedQuarantinePath !== "string") return null;
  if (value.kind !== "ownership" && value.kind !== "operation") {
    return null;
  }
  if (typeof value.createdAt !== "number") return null;
  return value as unknown as CorruptTombstone;
}

export function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function assertNextGeneration(
  expectedGen: number,
  nextGeneration: number
): void {
  if (!Number.isInteger(expectedGen) || expectedGen < 0) {
    throw new ProjectSkillsGenerationConflict({
      actualGeneration: null,
      expectedGeneration: expectedGen,
      ledger: "ownership",
    });
  }
  if (nextGeneration !== expectedGen + 1) {
    throw new Error(
      `project-skills next generation must be expectedGen+1 (got ${nextGeneration}, expected ${expectedGen + 1})`
    );
  }
}
