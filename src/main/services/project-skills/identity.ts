import { lstat, realpath, stat } from "node:fs/promises";

export interface StableProjectIdentity {
  /** dev/ino(/birth) stable key — independent of path string. */
  directoryIdentity: string;
  realPath: string;
  volumeId: string;
}

/**
 * Main-normalized project root handle.
 * Note: shared renderer contract flattens volume/directory fields on
 * `projectRootRefSchema`; this nested form is the main-side working type.
 */
export interface ProjectRootRef {
  identity: StableProjectIdentity;
  realPath: string;
  token?: string;
}

export type RekeyDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "old-path-still-present"
        | "identity-not-unique"
        | "new-project"
        | "volume-mismatch";
    };

/**
 * Resolve a stable project identity from a project root directory.
 * volumeId is the filesystem device id; directoryIdentity is dev:ino[:birthns].
 */
export async function resolveStableProjectIdentity(
  projectRootPath: string
): Promise<StableProjectIdentity> {
  const resolved = await realpath(projectRootPath);
  // Prefer non-follow? Project root must be a real directory; stat is fine
  // after realpath, but use lstat to refuse a final symlink segment.
  const linkInfo = await lstat(resolved);
  if (linkInfo.isSymbolicLink()) {
    throw new Error(`project root must not be a symbolic link: ${resolved}`);
  }
  const info = await stat(resolved);
  if (!info.isDirectory()) {
    throw new Error(`project root must be a directory: ${resolved}`);
  }

  const dev = typeof info.dev === "bigint" ? Number(info.dev) : info.dev;
  const ino = typeof info.ino === "bigint" ? Number(info.ino) : info.ino;
  let directoryIdentity = `${dev}:${ino}`;

  if ("birthtimeNs" in info && info.birthtimeNs !== undefined) {
    const birth =
      typeof info.birthtimeNs === "bigint"
        ? info.birthtimeNs.toString()
        : String(Math.round(Number(info.birthtimeNs)));
    directoryIdentity = `${directoryIdentity}:${birth}`;
  }

  return {
    realPath: resolved,
    // Volume identity for same-volume rename detection. On local macOS APFS
    // this is the device id; path-only volume labels are not required.
    volumeId: `dev:${dev}`,
    directoryIdentity,
  };
}

/**
 * Same-volume rename may rekey local ledgers only when:
 * - old path is gone
 * - next identity uniquely matches the previous directory identity on the same volume
 *
 * Clone / rebuild / path reuse with a new directory identity is always a new
 * project and must not inherit ownership state.
 */
export function canRekeyProjectIdentity(args: {
  previous: StableProjectIdentity;
  next: StableProjectIdentity;
  oldPathExists: boolean;
  /** How many known ledgers share previous.directoryIdentity on this volume. */
  matchingLedgerCount: number;
}): RekeyDecision {
  if (args.previous.volumeId !== args.next.volumeId) {
    return { allowed: false, reason: "new-project" };
  }

  if (args.previous.directoryIdentity !== args.next.directoryIdentity) {
    return { allowed: false, reason: "new-project" };
  }

  if (args.oldPathExists) {
    return { allowed: false, reason: "old-path-still-present" };
  }

  if (args.matchingLedgerCount !== 1) {
    return { allowed: false, reason: "identity-not-unique" };
  }

  return { allowed: true };
}

/** Map main nested identity into the flat renderer ProjectRootRef shape. */
export function toContractProjectRootRef(
  identity: StableProjectIdentity,
  token?: string
): {
  realPath: string;
  volumeIdentity: string;
  directoryIdentity: string;
  token?: string;
} {
  const ref: {
    realPath: string;
    volumeIdentity: string;
    directoryIdentity: string;
    token?: string;
  } = {
    realPath: identity.realPath,
    volumeIdentity: identity.volumeId,
    directoryIdentity: identity.directoryIdentity,
  };
  if (token !== undefined) {
    ref.token = token;
  }
  return ref;
}
