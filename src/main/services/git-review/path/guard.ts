import type { FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import {
  gitReviewRelativePathSchema,
  gitReviewRootPathSchema,
} from "../../../../shared/contracts/git/review.ts";
import type { GitExecExecutionBudget } from "../../git/exec-raw-contract.ts";
import { GitReviewPathError } from "./contract.ts";
import { openGitReviewFileNoSymlinks } from "./open.ts";
import {
  assertGitReviewPathActive,
  raceGitReviewPathOperation,
  settleGitReviewPathOperationInBackground,
} from "./operation.ts";
import {
  assertContained,
  hasExecuteBit,
  inspectAncestors,
  mapFileSystemError,
  readAndHash,
  resolveCanonicalRoot,
  revalidateAncestors,
  statToken,
} from "./path-helpers.ts";

export {
  GitReviewPathError,
  type GitReviewPathErrorReason,
} from "./contract.ts";

export const GIT_REVIEW_SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;

export interface GitReviewFileSnapshot {
  readonly bytes: Buffer;
  readonly digest: string;
  readonly executable: boolean;
  readonly identityToken: string;
  readonly size: number;
}

export type GitReviewFileFingerprint = Omit<GitReviewFileSnapshot, "bytes">;

export interface ReadGitReviewFileSnapshotOptions {
  readonly budget?: GitExecExecutionBudget;
  readonly gitRootPath: string;
  readonly maxBytes?: number;
  readonly path: string;
  readonly signal?: AbortSignal;
}

export async function readGitReviewFileSnapshot(
  options: ReadGitReviewFileSnapshotOptions
): Promise<GitReviewFileSnapshot> {
  const result = await readGitReviewFile(options, true);
  if (result.bytes === undefined) {
    throw new Error("Git Review snapshot 缺少正文");
  }
  return { ...result, bytes: result.bytes };
}

/** tracked fence 只流式计算摘要，不把最多 8 MiB 正文保留在内存。 */
export async function readGitReviewFileFingerprint(
  options: ReadGitReviewFileSnapshotOptions
): Promise<GitReviewFileFingerprint> {
  const { bytes: _bytes, ...fingerprint } = await readGitReviewFile(
    options,
    false
  );
  return fingerprint;
}

async function readGitReviewFile(
  options: ReadGitReviewFileSnapshotOptions,
  retainBytes: boolean
): Promise<GitReviewFileFingerprint & { readonly bytes?: Buffer }> {
  assertGitReviewPathActive(options.signal);
  const parsedRoot = gitReviewRootPathSchema.safeParse(options.gitRootPath);
  const parsedPath = gitReviewRelativePathSchema.safeParse(options.path);
  if (!(parsedRoot.success && parsedPath.success)) {
    throw new GitReviewPathError("outsideRoot", "Git Review 路径输入非法");
  }
  const maxBytes = options.maxBytes ?? GIT_REVIEW_SNAPSHOT_MAX_BYTES;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    maxBytes > GIT_REVIEW_SNAPSHOT_MAX_BYTES
  ) {
    throw new RangeError(
      `maxBytes must be between 0 and ${GIT_REVIEW_SNAPSHOT_MAX_BYTES}`
    );
  }

  const canonicalRoot = await resolveCanonicalRoot(
    parsedRoot.data,
    options.signal,
    options.budget
  );
  const target = resolve(canonicalRoot, parsedPath.data);
  assertContained(canonicalRoot, target);
  const segments =
    process.platform === "win32"
      ? parsedPath.data.split(/[\\/]/u)
      : parsedPath.data.split("/");
  const ancestors = await inspectAncestors(
    canonicalRoot,
    segments,
    options.signal,
    options.budget
  );
  let handle: FileHandle | undefined;
  let failed = false;
  let failure: unknown;
  let result:
    | (GitReviewFileFingerprint & { readonly bytes?: Buffer })
    | undefined;
  try {
    const openedHandle = await openGitReviewFileNoSymlinks({
      canonicalRoot,
      ...(options.budget === undefined ? {} : { budget: options.budget }),
      segments,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      target,
    });
    handle = openedHandle;
    const before = await raceGitReviewPathOperation(
      () => openedHandle.stat({ bigint: true }),
      options.signal,
      undefined,
      options.budget
    );
    if (!before.isFile()) {
      throw new GitReviewPathError(
        "notRegular",
        "Git Review 只允许读取普通文件"
      );
    }
    if (before.size > BigInt(maxBytes)) {
      throw new GitReviewPathError(
        "tooLarge",
        `Git Review 文件超过 ${maxBytes} bytes`
      );
    }
    const size = Number(before.size);
    const content = await readAndHash(
      openedHandle,
      size,
      retainBytes,
      options.signal
    );
    const after = await raceGitReviewPathOperation(
      () => openedHandle.stat({ bigint: true }),
      options.signal,
      undefined,
      options.budget
    );
    if (statToken(before) !== statToken(after)) {
      throw new GitReviewPathError(
        "changed",
        "Git Review 文件读取期间发生变化"
      );
    }
    await revalidateAncestors(
      canonicalRoot,
      ancestors,
      options.signal,
      options.budget
    );
    result = Object.freeze({
      ...(content.bytes === undefined ? {} : { bytes: content.bytes }),
      digest: `sha256:${content.digest}`,
      executable: hasExecuteBit(Number(before.mode)),
      identityToken: statToken(after),
      size,
    });
  } catch (error) {
    failed = true;
    failure =
      error instanceof GitReviewPathError
        ? error
        : mapFileSystemError(error, options.signal);
  }
  let closeAborted = false;
  let closeFailure: GitReviewPathError | undefined;
  if (handle !== undefined) {
    try {
      const close = handle.close();
      if (options.signal?.aborted) {
        closeAborted = true;
        settleGitReviewPathOperationInBackground(close, options.budget);
      } else {
        await raceGitReviewPathOperation(
          () => close,
          options.signal,
          undefined,
          options.budget
        );
      }
    } catch (error) {
      const mapped =
        error instanceof GitReviewPathError
          ? error
          : mapFileSystemError(error, options.signal);
      if (mapped.reason === "aborted") {
        closeAborted = true;
      } else {
        closeFailure = mapped;
      }
    }
  }
  if (failed) {
    throw failure;
  }
  if (closeFailure !== undefined) {
    throw closeFailure;
  }
  if (closeAborted) {
    assertGitReviewPathActive(options.signal);
  }
  if (result === undefined) {
    throw new Error("Git Review 文件读取未产生结果");
  }
  return result;
}
