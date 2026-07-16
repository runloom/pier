import { createHash } from "node:crypto";
import { type FileHandle, lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  gitReviewRelativePathSchema,
  gitReviewRootPathSchema,
} from "../../../shared/contracts/git-review.ts";
import type { GitExecExecutionBudget } from "../git-exec-raw-contract.ts";
import { GitReviewPathError } from "./git-review-path-contract.ts";
import { openGitReviewFileNoSymlinks } from "./git-review-path-open.ts";
import {
  assertGitReviewPathActive,
  raceGitReviewPathOperation,
  settleGitReviewPathOperationInBackground,
} from "./git-review-path-operation.ts";

export {
  GitReviewPathError,
  type GitReviewPathErrorReason,
} from "./git-review-path-contract.ts";

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

interface GitReviewAncestorIdentity {
  readonly canonicalPath: string;
  readonly path: string;
  readonly token: string;
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

function assertContained(root: string, target: string): void {
  const relation = relative(root, target);
  if (
    relation === "" ||
    relation === ".." ||
    relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(relation)
  ) {
    throw new GitReviewPathError(
      "outsideRoot",
      "Git Review 路径不在仓库根目录内"
    );
  }
}

async function inspectAncestors(
  root: string,
  segments: readonly string[],
  signal: AbortSignal | undefined,
  budget: GitExecExecutionBudget | undefined
): Promise<readonly GitReviewAncestorIdentity[]> {
  const ancestors: GitReviewAncestorIdentity[] = [];
  let current = root;
  for (const segment of [null, ...segments.slice(0, -1)]) {
    if (segment !== null) {
      current = join(current, segment);
    }
    try {
      const info = await raceGitReviewPathOperation(
        () => lstat(current, { bigint: true }),
        signal,
        undefined,
        budget
      );
      if (info.isSymbolicLink()) {
        throw new GitReviewPathError("symlink", "Git Review 路径包含符号链接");
      }
      if (!info.isDirectory()) {
        throw new GitReviewPathError(
          "notRegular",
          "Git Review 路径的中间节点不是目录"
        );
      }
      const canonicalPath = await raceGitReviewPathOperation(
        () => realpath(current),
        signal,
        undefined,
        budget
      );
      assertAncestorContained(root, canonicalPath);
      ancestors.push({
        canonicalPath,
        path: current,
        token: directoryToken(info),
      });
    } catch (error) {
      if (error instanceof GitReviewPathError) {
        throw error;
      }
      throw mapFileSystemError(error, signal);
    }
  }
  return ancestors;
}

async function revalidateAncestors(
  root: string,
  ancestors: readonly GitReviewAncestorIdentity[],
  signal: AbortSignal | undefined,
  budget: GitExecExecutionBudget | undefined
): Promise<void> {
  for (const ancestor of ancestors) {
    try {
      const info = await raceGitReviewPathOperation(
        () => lstat(ancestor.path, { bigint: true }),
        signal,
        undefined,
        budget
      );
      const canonicalPath = await raceGitReviewPathOperation(
        () => realpath(ancestor.path),
        signal,
        undefined,
        budget
      );
      if (
        info.isSymbolicLink() ||
        !info.isDirectory() ||
        directoryToken(info) !== ancestor.token ||
        canonicalPath !== ancestor.canonicalPath
      ) {
        throw new GitReviewPathError(
          "changed",
          "Git Review 文件祖先目录发生变化"
        );
      }
      assertAncestorContained(root, canonicalPath);
    } catch (error) {
      if (error instanceof GitReviewPathError) {
        throw error.reason === "outsideRoot"
          ? new GitReviewPathError(
              "changed",
              "Git Review 文件祖先目录移出仓库根目录",
              { cause: error }
            )
          : error;
      }
      throw new GitReviewPathError(
        "changed",
        "Git Review 文件祖先目录无法复核",
        { cause: error }
      );
    }
  }
}

function assertAncestorContained(root: string, path: string): void {
  if (path === root) {
    return;
  }
  assertContained(root, path);
}

async function readAndHash(
  handle: FileHandle,
  size: number,
  retainBytes: boolean,
  signal: AbortSignal | undefined
): Promise<{ readonly bytes?: Buffer; readonly digest: string }> {
  const bytes = retainBytes ? Buffer.allocUnsafe(size) : undefined;
  const digest = createHash("sha256");
  if (size === 0) {
    return {
      ...(bytes === undefined ? {} : { bytes }),
      digest: digest.digest("hex"),
    };
  }
  const stream = handle.createReadStream({
    autoClose: false,
    end: size - 1,
    highWaterMark: 64 * 1024,
    ...(signal === undefined ? {} : { signal }),
    start: 0,
  });
  let offset = 0;
  try {
    for await (const value of stream) {
      assertGitReviewPathActive(signal);
      if (!ArrayBuffer.isView(value)) {
        throw new GitReviewPathError(
          "readFailed",
          "Git Review 文件流返回了非法数据"
        );
      }
      const chunk = Buffer.from(
        value.buffer,
        value.byteOffset,
        value.byteLength
      );
      if (offset + chunk.length > size) {
        throw new GitReviewPathError("changed", "Git Review 文件读取超出预期");
      }
      digest.update(chunk);
      if (bytes !== undefined) {
        chunk.copy(bytes, offset);
      }
      offset += chunk.length;
    }
    if (offset !== size) {
      throw new GitReviewPathError("changed", "Git Review 文件提前结束");
    }
  } catch (error) {
    throw mapFileSystemError(error, signal);
  }
  return {
    ...(bytes === undefined ? {} : { bytes }),
    digest: digest.digest("hex"),
  };
}

async function resolveCanonicalRoot(
  root: string,
  signal: AbortSignal | undefined,
  budget: GitExecExecutionBudget | undefined
): Promise<string> {
  try {
    const canonical = await raceGitReviewPathOperation(
      () => realpath(resolve(root)),
      signal,
      undefined,
      budget
    );
    const info = await raceGitReviewPathOperation(
      () => lstat(canonical),
      signal,
      undefined,
      budget
    );
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new GitReviewPathError("outsideRoot", "Git Review 仓库根目录非法");
    }
    return canonical;
  } catch (error) {
    if (error instanceof GitReviewPathError) {
      throw error;
    }
    throw mapFileSystemError(error, signal);
  }
}

function hasExecuteBit(mode: number): boolean {
  const permissions = mode % 0o1000;
  return (
    Math.floor(permissions / 0o100) % 2 === 1 ||
    Math.floor(permissions / 0o10) % 2 === 1 ||
    permissions % 2 === 1
  );
}

function directoryToken(info: {
  readonly ctimeNs: bigint;
  readonly dev: bigint;
  readonly ino: bigint;
}): string {
  return `${info.dev}:${info.ino}:${info.ctimeNs}`;
}

function statToken(info: {
  readonly ctimeNs: bigint;
  readonly dev: bigint;
  readonly ino: bigint;
  readonly mode: bigint;
  readonly mtimeNs: bigint;
  readonly size: bigint;
}): string {
  return [
    info.dev,
    info.ino,
    info.mode,
    info.size,
    info.mtimeNs,
    info.ctimeNs,
  ].join(":");
}

function mapFileSystemError(
  error: unknown,
  signal?: AbortSignal
): GitReviewPathError {
  if (
    signal?.aborted ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return new GitReviewPathError("aborted", "Git Review 文件读取已取消", {
      cause: error,
    });
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : null;
  if (code === "ENOENT" || code === "ENOTDIR") {
    return new GitReviewPathError("missing", "Git Review 文件不存在", {
      cause: error,
    });
  }
  if (code === "ELOOP") {
    return new GitReviewPathError("symlink", "Git Review 拒绝符号链接", {
      cause: error,
    });
  }
  return new GitReviewPathError(
    "readFailed",
    error instanceof Error ? error.message : String(error),
    { cause: error }
  );
}
