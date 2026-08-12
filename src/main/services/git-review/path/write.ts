import type { FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import {
  gitReviewRelativePathSchema,
  gitReviewRootPathSchema,
} from "../../../../shared/contracts/git/review.ts";
import { GitReviewPathError } from "./contract.ts";
import type { ReadGitReviewFileSnapshotOptions } from "./guard.ts";
import { openGitReviewFileNoSymlinks } from "./open.ts";
import {
  assertGitReviewPathActive,
  raceGitReviewPathOperation,
  settleGitReviewPathOperationInBackground,
} from "./operation.ts";
import {
  assertContained,
  inspectAncestors,
  mapFileSystemError,
  resolveCanonicalRoot,
  revalidateAncestors,
} from "./path-helpers.ts";

/**
 * Write UTF-8 text through the same path fence as snapshot reads:
 * schema → canonical root → contained path → ancestor no-symlink → open no-symlink.
 */
export async function writeGitReviewFileContents(
  options: ReadGitReviewFileSnapshotOptions & {
    readonly contents: string;
  }
): Promise<void> {
  assertGitReviewPathActive(options.signal);
  const parsedRoot = gitReviewRootPathSchema.safeParse(options.gitRootPath);
  const parsedPath = gitReviewRelativePathSchema.safeParse(options.path);
  if (!(parsedRoot.success && parsedPath.success)) {
    throw new GitReviewPathError("outsideRoot", "Git Review 路径输入非法");
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
  try {
    const openedHandle = await openGitReviewFileNoSymlinks({
      access: "write",
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
        "Git Review 只允许写入普通文件"
      );
    }
    const bytes = Buffer.from(options.contents, "utf8");
    await raceGitReviewPathOperation(
      () => openedHandle.writeFile(bytes),
      options.signal,
      undefined,
      options.budget
    );
    await revalidateAncestors(
      canonicalRoot,
      ancestors,
      options.signal,
      options.budget
    );
  } catch (error) {
    if (error instanceof GitReviewPathError) {
      throw error;
    }
    throw mapFileSystemError(error, options.signal);
  } finally {
    if (handle !== undefined) {
      try {
        const close = handle.close();
        if (options.signal?.aborted) {
          settleGitReviewPathOperationInBackground(close, options.budget);
        } else {
          await raceGitReviewPathOperation(
            () => close,
            options.signal,
            undefined,
            options.budget
          );
        }
      } catch {
        // Close failures after a successful write are non-fatal for callers.
      }
    }
  }
}
