import { createHash } from "node:crypto";
import { type FileHandle, lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { GitExecExecutionBudget } from "../../git/exec-raw-contract.ts";
import { GitReviewPathError } from "./contract.ts";
import {
  assertGitReviewPathActive,
  raceGitReviewPathOperation,
} from "./operation.ts";

export interface GitReviewAncestorIdentity {
  readonly canonicalPath: string;
  readonly path: string;
  readonly token: string;
}

export function assertContained(root: string, target: string): void {
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

export async function inspectAncestors(
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

export async function revalidateAncestors(
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

export function assertAncestorContained(root: string, path: string): void {
  if (path === root) {
    return;
  }
  assertContained(root, path);
}

export async function readAndHash(
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

export async function resolveCanonicalRoot(
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

export function hasExecuteBit(mode: number): boolean {
  const permissions = mode % 0o1000;
  return (
    Math.floor(permissions / 0o100) % 2 === 1 ||
    Math.floor(permissions / 0o10) % 2 === 1 ||
    permissions % 2 === 1
  );
}

export function directoryToken(info: {
  readonly ctimeNs: bigint;
  readonly dev: bigint;
  readonly ino: bigint;
}): string {
  return `${info.dev}:${info.ino}:${info.ctimeNs}`;
}

export function statToken(info: {
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

export function mapFileSystemError(
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
