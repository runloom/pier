import { randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createProjectSkillsPaths } from "./paths.ts";
import type { LedgerCorruptCode } from "./store-errors.ts";
import {
  ProjectSkillsGenerationConflict,
  ProjectSkillsLedgerCorrupt,
  ProjectSkillsOperationConflict,
} from "./store-errors.ts";
import {
  assertNextGeneration,
  type CorruptTombstone,
  defaultRenameExclusive,
  ensureDir,
  isMissingPathError,
  parseOperation,
  parseOwnership,
  parseTombstone,
  sameJson,
  writeJsonAtomic,
} from "./store-parse.ts";
import { createStagingCandidateOps } from "./store-staging.ts";
import type {
  OperationRecord,
  OwnershipRecord,
  StagingCandidateCreateInput,
  StagingCandidateRecord,
} from "./store-types.ts";

export {
  type LedgerCorruptCode,
  ProjectSkillsGenerationConflict,
  ProjectSkillsLedgerCorrupt,
  ProjectSkillsOperationConflict,
  ProjectSkillsStagingConflict,
} from "./store-errors.ts";
export type {
  OperationRecord,
  OperationTerminalStatus,
  OwnershipRecord,
  OwnershipTarget,
  StagingCandidateCreateInput,
  StagingCandidateRecord,
  StagingCandidateSourceKind,
  StagingCandidateState,
} from "./store-types.ts";

export interface ProjectSkillsStore {
  /** AVAILABLE → CLAIMED(operationId). */
  claimCandidate(
    rootKey: string,
    token: string,
    operationId: string
  ): Promise<StagingCandidateRecord>;
  commitOwnership(
    rootKey: string,
    expectedGen: number,
    next: OwnershipRecord
  ): Promise<void>;
  /** CLAIMED(operationId) → CONSUMED (same operation only). */
  consumeCandidate(
    rootKey: string,
    token: string,
    operationId: string
  ): Promise<StagingCandidateRecord>;
  /** Create an AVAILABLE import candidate with a high-entropy token. */
  createCandidate(
    rootKey: string,
    input: StagingCandidateCreateInput
  ): Promise<StagingCandidateRecord>;
  /** Delete a CONSUMED candidate + staging tree for the owning operation. */
  destroyConsumed(
    rootKey: string,
    token: string,
    operationId: string
  ): Promise<void>;
  /** Delete AVAILABLE or RELEASED candidates only; never CLAIMED/CONSUMED. */
  discardAvailable(rootKey: string, token: string): Promise<void>;
  readCandidate(
    rootKey: string,
    token: string
  ): Promise<StagingCandidateRecord | null>;
  readOperation(
    rootKey: string,
    operationId: string
  ): Promise<OperationRecord | null>;
  readOwnership(rootKey: string): Promise<OwnershipRecord | null>;
  /** CLAIMED/CONSUMED(operationId) → RELEASED (same operation only). */
  releaseCandidate(
    rootKey: string,
    token: string,
    operationId: string
  ): Promise<StagingCandidateRecord>;
  writeOperation(
    rootKey: string,
    operationId: string,
    record: OperationRecord
  ): Promise<void>;
}

export interface ProjectSkillsStoreOptions {
  now?: () => number;
  /** Test seam for exclusive rename during quarantine. */
  renameExclusive?: (source: string, target: string) => Promise<void>;
  userData: string;
}

export function createProjectSkillsStore(
  options: ProjectSkillsStoreOptions
): ProjectSkillsStore {
  const paths = createProjectSkillsPaths(options.userData);
  const renameExclusive = options.renameExclusive ?? defaultRenameExclusive;
  const now = options.now ?? Date.now;
  const staging = createStagingCandidateOps({ paths, now });

  function tombstonePath(rootKey: string): string {
    return join(paths.projectDir(rootKey), ".corrupt-ownership.tombstone.json");
  }

  function quarantineDir(rootKey: string): string {
    return join(paths.projectDir(rootKey), "quarantine");
  }

  function operationPath(rootKey: string, operationId: string): string {
    if (
      !operationId ||
      operationId.includes("/") ||
      operationId.includes("\\") ||
      operationId.includes("..")
    ) {
      throw new Error("invalid operationId");
    }
    return join(paths.operationsDir(rootKey), `${operationId}.json`);
  }

  async function readTombstone(
    rootKey: string
  ): Promise<CorruptTombstone | null> {
    try {
      const raw = await readFile(tombstonePath(rootKey), "utf8");
      return parseTombstone(JSON.parse(raw) as unknown);
    } catch (error) {
      if (isMissingPathError(error)) return null;
      // Unreadable tombstone still means the ledger is not safely empty.
      return {
        createdAt: 0,
        kind: "ownership",
        originalPath: "ownership.json",
        plannedQuarantinePath: "",
        rootKey,
        schemaVersion: 1,
        state: "PREPARED",
      };
    }
  }

  async function isolateCorrupt(args: {
    rootKey: string;
    filePath: string;
    code: LedgerCorruptCode;
    reason: string;
  }): Promise<never> {
    const { rootKey, filePath, code, reason } = args;
    const kind = "ownership";
    await ensureDir(paths.projectDir(rootKey));
    await ensureDir(quarantineDir(rootKey));

    let originalIdentity: CorruptTombstone["originalIdentity"];
    try {
      const info = await lstat(filePath);
      originalIdentity = {
        dev: info.dev,
        ino: info.ino,
        mode: info.mode,
        nlink: info.nlink,
      };
    } catch {
      originalIdentity = undefined;
    }

    const quarantineName = `${kind}-${now()}-${randomUUID()}.json`;
    const plannedQuarantinePath = join(quarantineDir(rootKey), quarantineName);
    const prepared: CorruptTombstone = {
      createdAt: now(),
      kind,
      ...(originalIdentity === undefined ? {} : { originalIdentity }),
      originalPath: filePath,
      plannedQuarantinePath,
      rootKey,
      schemaVersion: 1,
      state: "PREPARED",
    };

    // Durable PREPARED tombstone before any move.
    await writeJsonAtomic(tombstonePath(rootKey), prepared);

    try {
      await renameExclusive(filePath, plannedQuarantinePath);
    } catch (error) {
      if (!isMissingPathError(error)) {
        // Move indeterminate/failed: keep PREPARED and block.
        throw new ProjectSkillsLedgerCorrupt(
          code,
          `${reason}; quarantine move failed while PREPARED tombstone retained`
        );
      }
      // Already gone after PREPARED — still block via tombstone.
    }

    const quarantined: CorruptTombstone = {
      ...prepared,
      state: "QUARANTINED",
    };
    await writeJsonAtomic(tombstonePath(rootKey), quarantined);

    throw new ProjectSkillsLedgerCorrupt(code, reason);
  }

  async function readOwnership(
    rootKey: string
  ): Promise<OwnershipRecord | null> {
    const filePath = paths.ownershipPath(rootKey);
    const tombstone = await readTombstone(rootKey);
    if (tombstone) {
      throw new ProjectSkillsLedgerCorrupt(
        "ledger-corrupt",
        "ownership ledger is quarantined or isolation is incomplete"
      );
    }

    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if (isMissingPathError(error)) return null;
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return await isolateCorrupt({
        code: "ledger-corrupt",
        filePath,
        reason: "ownership.json is not valid JSON",
        rootKey,
      });
    }

    const record = parseOwnership(parsed);
    if (!record) {
      return await isolateCorrupt({
        code: "ledger-corrupt",
        filePath,
        reason: "ownership.json failed schema validation",
        rootKey,
      });
    }
    return record;
  }

  async function commitOwnership(
    rootKey: string,
    expectedGen: number,
    next: OwnershipRecord
  ): Promise<void> {
    if (next.schemaVersion !== 1) {
      throw new Error("ownership schemaVersion must be 1");
    }
    assertNextGeneration(expectedGen, next.generation);

    const current = await readOwnership(rootKey);
    const actual = current?.generation ?? null;
    if (actual === null) {
      if (expectedGen !== 0) {
        throw new ProjectSkillsGenerationConflict({
          actualGeneration: null,
          expectedGeneration: expectedGen,
          ledger: "ownership",
        });
      }
    } else if (actual !== expectedGen) {
      throw new ProjectSkillsGenerationConflict({
        actualGeneration: actual,
        expectedGeneration: expectedGen,
        ledger: "ownership",
      });
    }

    await writeJsonAtomic(paths.ownershipPath(rootKey), next);
  }

  async function readOperation(
    rootKey: string,
    operationId: string
  ): Promise<OperationRecord | null> {
    const filePath = operationPath(rootKey, operationId);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if (isMissingPathError(error)) return null;
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new ProjectSkillsLedgerCorrupt(
        "recovery-record-corrupt",
        `operation ${operationId} is not valid JSON`
      );
    }

    const record = parseOperation(parsed);
    if (!record) {
      throw new ProjectSkillsLedgerCorrupt(
        "recovery-record-corrupt",
        `operation ${operationId} failed schema validation`
      );
    }
    return record;
  }

  async function writeOperation(
    rootKey: string,
    operationId: string,
    record: OperationRecord
  ): Promise<void> {
    const parsed = parseOperation(record);
    if (!parsed) {
      throw new Error("invalid operation record");
    }

    const existing = await readOperation(rootKey, operationId);
    if (existing) {
      if (existing.kind === "terminal") {
        if (record.kind !== "terminal") {
          throw new ProjectSkillsOperationConflict(
            `operation ${operationId} is terminal and immutable`
          );
        }
        if (existing.requestDigest !== record.requestDigest) {
          throw new ProjectSkillsOperationConflict(
            `operation ${operationId} requestDigest mismatch`
          );
        }
        if (
          existing.status !== record.status ||
          !sameJson(existing.result, record.result)
        ) {
          throw new ProjectSkillsOperationConflict(
            `operation ${operationId} terminal result is immutable`
          );
        }
        // Idempotent replay of the same terminal record.
        return;
      }

      // in-flight may advance to a new in-flight phase or terminal with same digest.
      if (record.kind === "in-flight") {
        if (existing.requestDigest !== record.requestDigest) {
          throw new ProjectSkillsOperationConflict(
            `operation ${operationId} requestDigest mismatch`
          );
        }
      } else if (existing.requestDigest !== record.requestDigest) {
        throw new ProjectSkillsOperationConflict(
          `operation ${operationId} requestDigest mismatch`
        );
      }
    }

    await writeJsonAtomic(operationPath(rootKey, operationId), parsed);
  }

  return {
    claimCandidate: staging.claimCandidate,
    commitOwnership,
    consumeCandidate: staging.consumeCandidate,
    createCandidate: staging.createCandidate,
    discardAvailable: staging.discardAvailable,
    destroyConsumed: staging.destroyConsumed,
    readCandidate: staging.readCandidate,
    readOperation,
    readOwnership,
    releaseCandidate: staging.releaseCandidate,
    writeOperation,
  };
}
