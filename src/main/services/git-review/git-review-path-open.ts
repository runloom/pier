import { constants } from "node:fs";
import { type FileHandle, open as fsOpen } from "node:fs/promises";
import type { GitExecExecutionBudget } from "../git-exec-raw-contract.ts";
import { GitReviewPathError } from "./git-review-path-contract.ts";
import {
  closeGitReviewFileHandleInBackground,
  raceGitReviewPathOperation,
} from "./git-review-path-operation.ts";

// macOS 的 O_NOFOLLOW_ANY 会让内核拒绝路径任意层级的符号链接。
// Node 尚未暴露该常量，数值来自 macOS SDK sys/fcntl.h。
const DARWIN_O_NOFOLLOW_ANY = 0x20_00_00_00;

interface OpenGitReviewFileOptions {
  readonly budget?: GitExecExecutionBudget;
  readonly canonicalRoot: string;
  readonly segments: readonly string[];
  readonly signal?: AbortSignal;
  readonly target: string;
}

export async function openGitReviewFileNoSymlinks(
  options: OpenGitReviewFileOptions
): Promise<FileHandle> {
  if (process.platform === "darwin") {
    return raceGitReviewPathOperation(
      () => fsOpen(options.target, fileFlags(DARWIN_O_NOFOLLOW_ANY)),
      options.signal,
      (handle) => closeGitReviewFileHandleInBackground(handle, options.budget),
      options.budget
    );
  }
  if (process.platform === "linux") {
    return openLinuxAnchored(options);
  }
  if (process.platform === "win32") {
    throw new GitReviewPathError(
      "readFailed",
      "当前平台不支持无符号链接竞态的安全工作树读取"
    );
  }
  throw new GitReviewPathError(
    "readFailed",
    "当前平台不支持无符号链接竞态的安全工作树读取"
  );
}

async function openLinuxAnchored(
  options: OpenGitReviewFileOptions
): Promise<FileHandle> {
  const fileName = options.segments.at(-1);
  if (fileName === undefined) {
    throw new GitReviewPathError("outsideRoot", "Git Review 文件路径为空");
  }
  let directory: FileHandle | undefined;
  try {
    directory = await raceGitReviewPathOperation(
      () => fsOpen(options.canonicalRoot, directoryFlags()),
      options.signal,
      (handle) => closeGitReviewFileHandleInBackground(handle, options.budget),
      options.budget
    );
    for (const segment of options.segments.slice(0, -1)) {
      const next = await raceGitReviewPathOperation(
        () =>
          fsOpen(procChild(directory as FileHandle, segment), directoryFlags()),
        options.signal,
        (handle) =>
          closeGitReviewFileHandleInBackground(handle, options.budget),
        options.budget
      );
      closeGitReviewFileHandleInBackground(directory, options.budget);
      directory = next;
    }
    const target = await raceGitReviewPathOperation(
      () => fsOpen(procChild(directory as FileHandle, fileName), fileFlags()),
      options.signal,
      (handle) => closeGitReviewFileHandleInBackground(handle, options.budget),
      options.budget
    );
    closeGitReviewFileHandleInBackground(directory, options.budget);
    directory = undefined;
    return target;
  } catch (error) {
    if (directory !== undefined) {
      closeGitReviewFileHandleInBackground(directory, options.budget);
    }
    throw error;
  }
}

function procChild(directory: FileHandle, segment: string): string {
  return `/proc/self/fd/${directory.fd}/${segment}`;
}

function directoryFlags(): number {
  return (
    constants.O_RDONLY +
    constants.O_NONBLOCK +
    constants.O_DIRECTORY +
    constants.O_NOFOLLOW
  );
}

function fileFlags(noFollow = constants.O_NOFOLLOW): number {
  return constants.O_RDONLY + constants.O_NONBLOCK + noFollow;
}
