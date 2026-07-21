import type { FsObjectIdentity } from "./fs-adapter.ts";
import type { StableProjectIdentity } from "./identity.ts";

/**
 * Durable ownership, operation, and staging record types.
 */

export type StagingCandidateSourceKind =
  | "local-import"
  | "project-discovery-import"
  | "git-declared"
  | "content-update"
  | "drift-accepted";

export interface OwnershipTarget {
  createdAt: number;
  createdByOperationId: string;
  expectedRelativeLinkTarget: string;
  objectIdentity: FsObjectIdentity;
  relativePath: string;
  skillId: string;
}

export interface OwnershipRecord {
  generation: number;
  projectIdentity: StableProjectIdentity;
  schemaVersion: 1;
  targets: OwnershipTarget[];
}

export type OperationTerminalStatus =
  | "converged"
  | "degraded"
  | "not-applied"
  | "superseded"
  | "recovery-blocked";

export type OperationRecord =
  | {
      kind: "in-flight";
      phase: string;
      requestDigest: string;
    }
  | {
      kind: "terminal";
      status: OperationTerminalStatus;
      requestDigest: string;
      result: unknown;
    };

export type StagingCandidateState =
  | "AVAILABLE"
  | "CLAIMED"
  | "CONSUMED"
  | "RELEASED";

export interface StagingCandidateCreateInput {
  baseContentDigest?: string;
  /**
   * Content-update candidates only (design v9 §6.1): the library tree digest
   * this edit was based on. Apply refuses to publish when the on-disk library
   * digest no longer equals this base (concurrent-change guard).
   */
  baseSkillId?: string;
  contentDigest: string;
  expiresAt: number;
  skillId: string;
  sourceKind: StagingCandidateSourceKind;
  treeDigest: string;
}

export type StagingCandidateRecord = StagingCandidateCreateInput & {
  token: string;
  state: StagingCandidateState;
  createdAt: number;
  operationId?: string;
};
