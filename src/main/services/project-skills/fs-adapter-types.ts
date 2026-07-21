/**
 * Filesystem adapter contract types, split from fs-adapter.ts (file-size
 * cap). Behavior unchanged.
 */

export interface FsObjectIdentity {
  birthtimeNs?: bigint;
  dev: number;
  ino: number;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  mode: number;
  nlink: number;
}

export type PublishNoReplaceResult =
  | { status: "created"; identity: FsObjectIdentity }
  | { status: "conflict"; reason: "target-exists" | "parent-invalid" };

export type PublishReplaceReviewResult =
  | { status: "replaced"; identity: FsObjectIdentity; postCheck: "matched" }
  | { status: "conflict"; reason: "target-changed" | "target-missing" }
  | {
      status: "indeterminate";
      reason: "post-check-diverged" | "sync-unknown";
    };

export type PublishFileExpectedState =
  | { kind: "absent" }
  | { kind: "present"; identity: FsObjectIdentity; digest: string };

export interface PublishFileReplaceArgs {
  /** Test seam: runs immediately before the final expectation check. */
  beforePublish?: () => Promise<void>;
  bytes: Buffer;
  digestOf: (bytes: Buffer) => string;
  expected: PublishFileExpectedState;
  path: string;
}

export interface ProjectSkillsFileSystemAdapter {
  lstatIdentity(path: string): Promise<FsObjectIdentity>;
  probeCapabilities(rootPath: string): Promise<{
    writable: boolean;
    supportsNoFollow: boolean;
    supportsDirSync: boolean;
    kind: "local-reliable" | "unsupported";
  }>;
  publishFileReplaceIfUnchanged(
    args: PublishFileReplaceArgs
  ): Promise<PublishReplaceReviewResult>;
  publishSymlinkNoReplace(args: {
    linkPath: string;
    relativeTarget: string;
    /**
     * When set, verify every existing ancestor of `linkPath` under this
     * project root is a real directory (design §6.1). Callers that omit it
     * must ensure ancestors via `ensureProjectRelativeDir` first.
     */
    projectRoot?: string;
  }): Promise<PublishNoReplaceResult>;
  syncDirectory(path: string): Promise<void>;
}

export interface ProjectSkillsFileSystemAdapterOptions {
  renameExclusive?: (source: string, target: string) => Promise<void>;
  renameFile?: (source: string, target: string) => Promise<void>;
  syncDirectory?: (directory: string) => Promise<void>;
}
