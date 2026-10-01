import { randomUUID } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import { type FileHandle, lstat, open, rename, unlink } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { basename, dirname } from "node:path";
import { getSystemErrorName } from "node:util";
import { loadNativeBinding } from "../../../native-module.ts";
import { openGitPathNoSymlinks } from "../../git/safe-path-open.ts";
import { GitReviewPathError } from "./contract.ts";
import { assertGitReviewPathActive } from "./operation.ts";
import { statToken } from "./path-helpers.ts";

interface AtomicFileBinding {
  replaceFileAtomically(
    source: number,
    parent: string,
    name: string,
    contents: Buffer,
    expectedIdentity: string,
    parentIdentity: string
  ): number;
}

function matchesCandidate(value: BigIntStats, expected: BigIntStats): boolean {
  return (
    value.isFile() &&
    value.dev === expected.dev &&
    value.ino === expected.ino &&
    value.mode === expected.mode &&
    value.uid === expected.uid &&
    value.gid === expected.gid &&
    value.size === expected.size &&
    value.mtimeNs === expected.mtimeNs &&
    value.ctimeNs === expected.ctimeNs
  );
}

async function verifyCandidateContents(
  temporary: FileHandle,
  expected: Buffer
): Promise<void> {
  if (expected.length === 0) return;
  const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, expected.length));
  let offset = 0;
  while (offset < expected.length) {
    const { bytesRead } = await temporary.read(
      buffer,
      0,
      Math.min(buffer.length, expected.length - offset),
      offset
    );
    if (
      bytesRead === 0 ||
      buffer.compare(expected, offset, offset + bytesRead, 0, bytesRead) !== 0
    ) {
      throw new GitReviewPathError(
        "changed",
        "The publication candidate contents changed before publication"
      );
    }
    offset += bytesRead;
  }
}

async function removeOwnedCandidate(
  temporary: FileHandle,
  path: string
): Promise<void> {
  try {
    const owned = await temporary.stat({ bigint: true });
    const entry = await lstat(path, { bigint: true });
    if (entry.isFile() && entry.dev === owned.dev && entry.ino === owned.ino) {
      await unlink(path);
    }
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

/** Publish complete bytes by rename; neither failure nor stale evidence truncates the source. */
export async function publishGitReviewFile(options: {
  readonly canonicalRoot: string;
  readonly contents: Buffer;
  readonly expectedIdentity: string;
  readonly parent: BigIntStats;
  readonly segments: readonly string[];
  readonly signal: AbortSignal | undefined;
  readonly source: FileHandle;
  readonly target: string;
}): Promise<void> {
  assertGitReviewPathActive(options.signal);
  const parentIdentity = `${options.parent.dev}:${options.parent.ino}`;
  if (process.platform === "darwin") {
    const { addon } = loadNativeBinding<AtomicFileBinding>();
    const result = addon.replaceFileAtomically(
      options.source.fd,
      dirname(options.target),
      basename(options.target),
      options.contents,
      options.expectedIdentity,
      parentIdentity
    );
    if (result !== 0) {
      // The addon returns POSIX errno, not libuv's error-name table.
      if (
        result === osConstants.errno.ESTALE ||
        result === osConstants.errno.ENOENT ||
        result === osConstants.errno.ELOOP
      ) {
        throw new GitReviewPathError(
          "changed",
          "The conflict file changed before publication"
        );
      }
      const code = getSystemErrorName(-result);
      throw Object.assign(
        new Error(`Atomic conflict publication failed: ${code}`),
        { code }
      );
    }
    return;
  }
  // The safe-open primitive refuses unsupported platforms. Linux provides
  // descriptor-anchored filesystem operations through /proc/self/fd.
  const directoryOptions = {
    canonicalRoot: options.canonicalRoot,
    segments:
      options.segments.length === 1 ? ["."] : options.segments.slice(0, -1),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    target: dirname(options.target),
  };
  const directory = await openGitPathNoSymlinks(directoryOptions);
  let temporary: FileHandle | undefined;
  let temporaryPath: string | undefined;
  try {
    const parent = await directory.stat({ bigint: true });
    if (
      !parent.isDirectory() ||
      `${parent.dev}:${parent.ino}` !== parentIdentity
    ) {
      throw new GitReviewPathError(
        "changed",
        "The conflict directory changed before publication"
      );
    }
    const target = `/proc/self/fd/${directory.fd}/${basename(options.target)}`;
    const candidate = `/proc/self/fd/${directory.fd}/.pier-conflict-${randomUUID()}.tmp`;
    temporary = await open(
      candidate,
      constants.O_RDWR +
        constants.O_CREAT +
        constants.O_EXCL +
        constants.O_NOFOLLOW,
      0o600
    );
    temporaryPath = candidate;
    const source = await options.source.stat({ bigint: true });
    if (statToken(source) !== options.expectedIdentity) {
      throw new GitReviewPathError(
        "changed",
        "The conflict file changed before publication"
      );
    }
    await temporary.writeFile(options.contents);
    await temporary.chown(Number(source.uid), Number(source.gid));
    await temporary.chmod(Number(source.mode % 0o10000n));
    const candidateStat = await temporary.stat({ bigint: true });
    await temporary.sync();
    const beforeContents = await temporary.stat({ bigint: true });
    if (
      !matchesCandidate(beforeContents, candidateStat) ||
      candidateStat.mode !== source.mode ||
      candidateStat.uid !== source.uid ||
      candidateStat.gid !== source.gid ||
      candidateStat.size !== BigInt(options.contents.length)
    ) {
      throw new GitReviewPathError(
        "changed",
        "The publication candidate changed before publication"
      );
    }
    await verifyCandidateContents(temporary, options.contents);
    const currentDirectory = await openGitPathNoSymlinks(directoryOptions);
    const currentParent = await currentDirectory
      .stat({ bigint: true })
      .finally(() => currentDirectory.close());
    const currentSource = await options.source.stat({ bigint: true });
    const currentTarget = await lstat(target, { bigint: true });
    if (
      !currentParent.isDirectory() ||
      `${currentParent.dev}:${currentParent.ino}` !== parentIdentity ||
      statToken(currentSource) !== options.expectedIdentity ||
      statToken(currentTarget) !== options.expectedIdentity
    ) {
      throw new GitReviewPathError(
        "changed",
        "The conflict file changed before publication"
      );
    }
    const currentCandidate = await temporary.stat({ bigint: true });
    const candidateEntry = await lstat(candidate, { bigint: true }).catch(
      (error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          throw new GitReviewPathError(
            "changed",
            "The publication candidate disappeared before publication",
            { cause: error }
          );
        }
        throw error;
      }
    );
    if (
      !(
        matchesCandidate(currentCandidate, candidateStat) &&
        matchesCandidate(candidateEntry, candidateStat)
      )
    ) {
      throw new GitReviewPathError(
        "changed",
        "The publication candidate changed before publication"
      );
    }
    assertGitReviewPathActive(options.signal);
    // Final stat checks are guards, not a kernel compare-and-swap with rename.
    await rename(candidate, target);
    temporaryPath = undefined;
  } finally {
    try {
      if (temporary !== undefined && temporaryPath !== undefined) {
        await removeOwnedCandidate(temporary, temporaryPath);
      }
    } finally {
      try {
        await temporary?.close();
      } finally {
        await directory.close();
      }
    }
  }
}
