import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { createProjectSkillsPaths } from "./paths.ts";
import { ProjectSkillsStagingConflict } from "./store-errors.ts";
import {
  ensureDir,
  isErrno,
  isMissingPathError,
  parseStaging,
  writeJsonAtomic,
} from "./store-parse.ts";
import type {
  StagingCandidateCreateInput,
  StagingCandidateRecord,
} from "./store-types.ts";

/**
 * Import staging candidate state machine (AVAILABLE → CLAIMED → CONSUMED /
 * RELEASED), split from store.ts (file-size cap). Behavior unchanged.
 */

export interface StagingCandidateOps {
  claimCandidate(
    rootKey: string,
    token: string,
    operationId: string
  ): Promise<StagingCandidateRecord>;
  consumeCandidate(
    rootKey: string,
    token: string,
    operationId: string
  ): Promise<StagingCandidateRecord>;
  createCandidate(
    rootKey: string,
    input: StagingCandidateCreateInput
  ): Promise<StagingCandidateRecord>;
  /**
   * After FINALIZED (or immediately post-consume once the library publish is
   * durable): delete the CONSUMED candidate record and its staging tree so
   * the 512 MiB quota is not permanently occupied (§4.2.7).
   */
  destroyConsumed(
    rootKey: string,
    token: string,
    operationId: string
  ): Promise<void>;
  discardAvailable(rootKey: string, token: string): Promise<void>;
  readCandidate(
    rootKey: string,
    token: string
  ): Promise<StagingCandidateRecord | null>;
  releaseCandidate(
    rootKey: string,
    token: string,
    operationId: string
  ): Promise<StagingCandidateRecord>;
}

export function createStagingCandidateOps(args: {
  paths: ReturnType<typeof createProjectSkillsPaths>;
  now: () => number;
}): StagingCandidateOps {
  const { paths, now } = args;

  function stagingPath(rootKey: string, token: string): string {
    if (
      !token ||
      token.includes("/") ||
      token.includes("\\") ||
      token.includes("..")
    ) {
      throw new Error("invalid staging token");
    }
    return join(paths.stagingDir(rootKey), `${token}.json`);
  }

  async function readCandidate(
    rootKey: string,
    token: string
  ): Promise<StagingCandidateRecord | null> {
    const filePath = stagingPath(rootKey, token);
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
      throw new ProjectSkillsStagingConflict(
        `staging candidate ${token} is corrupt`
      );
    }
    const record = parseStaging(parsed);
    if (!record) {
      throw new ProjectSkillsStagingConflict(
        `staging candidate ${token} failed schema validation`
      );
    }
    return record;
  }

  async function writeCandidate(
    rootKey: string,
    record: StagingCandidateRecord
  ): Promise<void> {
    await writeJsonAtomic(stagingPath(rootKey, record.token), record);
  }

  async function createCandidate(
    rootKey: string,
    input: StagingCandidateCreateInput
  ): Promise<StagingCandidateRecord> {
    const token = randomBytes(24).toString("hex");
    const record: StagingCandidateRecord = {
      ...input,
      createdAt: now(),
      state: "AVAILABLE",
      token,
    };
    await ensureDir(paths.stagingDir(rootKey));
    // Exclusive create — do not replace an existing token file.
    const filePath = stagingPath(rootKey, token);
    try {
      await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (isErrno(error, "EEXIST")) {
        throw new ProjectSkillsStagingConflict("staging token collision");
      }
      throw error;
    }
    return record;
  }

  async function claimCandidate(
    rootKey: string,
    token: string,
    operationId: string
  ): Promise<StagingCandidateRecord> {
    const current = await readCandidate(rootKey, token);
    if (!current) {
      throw new ProjectSkillsStagingConflict(
        `staging candidate ${token} missing`
      );
    }
    if (current.state === "CLAIMED" && current.operationId === operationId) {
      return current;
    }
    if (current.state !== "AVAILABLE") {
      throw new ProjectSkillsStagingConflict(
        `staging candidate ${token} is ${current.state}, expected AVAILABLE`
      );
    }
    if (current.expiresAt <= now()) {
      throw new ProjectSkillsStagingConflict(
        `staging candidate ${token} is expired`
      );
    }
    const next: StagingCandidateRecord = {
      ...current,
      operationId,
      state: "CLAIMED",
    };
    await writeCandidate(rootKey, next);
    return next;
  }

  async function consumeCandidate(
    rootKey: string,
    token: string,
    operationId: string
  ): Promise<StagingCandidateRecord> {
    const current = await readCandidate(rootKey, token);
    if (!current) {
      throw new ProjectSkillsStagingConflict(
        `staging candidate ${token} missing`
      );
    }
    if (current.state === "CONSUMED" && current.operationId === operationId) {
      return current;
    }
    if (current.state !== "CLAIMED" || current.operationId !== operationId) {
      throw new ProjectSkillsStagingConflict(
        `staging candidate ${token} cannot be consumed by ${operationId}`
      );
    }
    const next: StagingCandidateRecord = {
      ...current,
      operationId,
      state: "CONSUMED",
    };
    await writeCandidate(rootKey, next);
    return next;
  }

  async function releaseCandidate(
    rootKey: string,
    token: string,
    operationId: string
  ): Promise<StagingCandidateRecord> {
    const current = await readCandidate(rootKey, token);
    if (!current) {
      throw new ProjectSkillsStagingConflict(
        `staging candidate ${token} missing`
      );
    }
    if (current.state === "RELEASED" && current.operationId === operationId) {
      return current;
    }
    if (
      (current.state !== "CLAIMED" && current.state !== "CONSUMED") ||
      current.operationId !== operationId
    ) {
      throw new ProjectSkillsStagingConflict(
        `staging candidate ${token} cannot be released by ${operationId}`
      );
    }
    const next: StagingCandidateRecord = {
      ...current,
      operationId,
      state: "RELEASED",
    };
    await writeCandidate(rootKey, next);
    return next;
  }

  async function discardAvailable(
    rootKey: string,
    token: string
  ): Promise<void> {
    const current = await readCandidate(rootKey, token);
    if (!current) {
      // Idempotent discard of missing candidate.
      return;
    }
    if (current.state !== "AVAILABLE" && current.state !== "RELEASED") {
      throw new ProjectSkillsStagingConflict(
        `staging candidate ${token} is ${current.state}; discard only ALLOWED for AVAILABLE/RELEASED`
      );
    }
    await rm(stagingPath(rootKey, token), { force: true });
  }

  async function destroyConsumed(
    rootKey: string,
    token: string,
    operationId: string
  ): Promise<void> {
    const current = await readCandidate(rootKey, token);
    if (
      current &&
      (current.state !== "CONSUMED" || current.operationId !== operationId)
    ) {
      throw new ProjectSkillsStagingConflict(
        `staging candidate ${token} cannot be destroyed (state=${current.state})`
      );
    }
    const treeParent = join(paths.stagingDir(rootKey), token);
    await rm(treeParent, { force: true, recursive: true }).catch(
      () => undefined
    );
    await rm(stagingPath(rootKey, token), { force: true }).catch(
      () => undefined
    );
  }

  return {
    claimCandidate,
    consumeCandidate,
    createCandidate,
    discardAvailable,
    destroyConsumed,
    readCandidate,
    releaseCandidate,
  };
}
