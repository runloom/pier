import { createHash } from "node:crypto";
import { join } from "node:path";
import type { StableProjectIdentity } from "./identity.ts";

/**
 * Local state layout under `{userData}/project-skills/<root-key>/…`.
 * root-key is derived from volumeId + directoryIdentity only (not realPath),
 * so same-volume rename can rekey by moving/renaming the ledger directory
 * while the key itself stays stable for a given directory object identity.
 */
export function createProjectSkillsPaths(userData: string): {
  rootKeyFor(identity: StableProjectIdentity): string;
  projectDir(rootKey: string): string;
  ownershipPath(rootKey: string): string;
  operationsDir(rootKey: string): string;
  stagingDir(rootKey: string): string;
} {
  const base = join(userData, "project-skills");

  return {
    rootKeyFor(identity: StableProjectIdentity): string {
      // Path is intentionally excluded: rename must not orphan ledgers.
      return createHash("sha256")
        .update("project-skills-root-key-v1\0", "utf8")
        .update(identity.volumeId, "utf8")
        .update("\0", "utf8")
        .update(identity.directoryIdentity, "utf8")
        .digest("hex");
    },
    projectDir(rootKey: string): string {
      return join(base, rootKey);
    },
    ownershipPath(rootKey: string): string {
      return join(base, rootKey, "ownership.json");
    },
    operationsDir(rootKey: string): string {
      return join(base, rootKey, "operations");
    },
    stagingDir(rootKey: string): string {
      return join(base, rootKey, "staging");
    },
  };
}
