import { constants } from "node:fs";
import { type FileHandle, open as fsOpen } from "node:fs/promises";

// macOS 的 O_NOFOLLOW_ANY 会让内核拒绝路径任意层级的符号链接。
// Node 尚未暴露该常量，数值来自 macOS SDK sys/fcntl.h。
const DARWIN_O_NOFOLLOW_ANY = 0x20_00_00_00;

export class GitSafePathOpenError extends Error {
  readonly reason: "aborted" | "unsupported";

  constructor(
    reason: "aborted" | "unsupported",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "GitSafePathOpenError";
    this.reason = reason;
  }
}

export interface OpenGitPathNoSymlinksOptions {
  readonly canonicalRoot: string;
  readonly onDetachedOperation?: (operation: Promise<unknown>) => void;
  readonly segments: readonly string[];
  readonly signal?: AbortSignal;
  readonly target: string;
}

/**
 * 以内核锚定方式打开仓库内文件：macOS 使用 O_NOFOLLOW_ANY，Linux 逐层 fd 锚定，
 * Windows 与未知平台保守拒绝。调用方仍必须 fstat 前后验证读取期间的身份稳定。
 */
export async function openGitPathNoSymlinks(
  options: OpenGitPathNoSymlinksOptions
): Promise<FileHandle> {
  if (process.platform === "darwin") {
    return racePathOpen(
      () => fsOpen(options.target, fileFlags(DARWIN_O_NOFOLLOW_ANY)),
      options
    );
  }
  if (process.platform === "linux") {
    return openLinuxAnchored(options);
  }
  throw new GitSafePathOpenError(
    "unsupported",
    "当前平台不支持无符号链接竞态的安全工作树读取"
  );
}

async function openLinuxAnchored(
  options: OpenGitPathNoSymlinksOptions
): Promise<FileHandle> {
  const fileName = options.segments.at(-1);
  if (fileName === undefined) {
    throw new GitSafePathOpenError("unsupported", "Git 仓库相对路径为空");
  }
  let directory: FileHandle | undefined;
  try {
    directory = await racePathOpen(
      () => fsOpen(options.canonicalRoot, directoryFlags()),
      options
    );
    for (const segment of options.segments.slice(0, -1)) {
      const next = await racePathOpen(
        () =>
          fsOpen(procChild(directory as FileHandle, segment), directoryFlags()),
        options
      );
      closeInBackground(directory, options.onDetachedOperation);
      directory = next;
    }
    const target = await racePathOpen(
      () => fsOpen(procChild(directory as FileHandle, fileName), fileFlags()),
      options
    );
    closeInBackground(directory, options.onDetachedOperation);
    directory = undefined;
    return target;
  } catch (error) {
    if (directory !== undefined) {
      closeInBackground(directory, options.onDetachedOperation);
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

function closeInBackground(
  handle: FileHandle,
  onDetachedOperation: OpenGitPathNoSymlinksOptions["onDetachedOperation"]
): void {
  const close = handle.close();
  onDetachedOperation?.(close);
  close.catch(() => undefined);
}

async function racePathOpen<T>(
  operation: () => Promise<T>,
  options: OpenGitPathNoSymlinksOptions
): Promise<T> {
  if (options.signal?.aborted) {
    throw abortedError(options.signal.reason);
  }
  if (options.signal === undefined) {
    return operation();
  }
  const signal = options.signal;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let pending: Promise<T> | undefined;
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    const abort = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (pending !== undefined) {
        options.onDetachedOperation?.(pending);
      }
      reject(abortedError(signal.reason));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    try {
      pending = operation();
    } catch (error) {
      settled = true;
      cleanup();
      reject(error);
      return;
    }
    pending.then(
      (value) => {
        if (settled) {
          if (isFileHandle(value)) {
            closeInBackground(value, options.onDetachedOperation);
          }
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      }
    );
  });
}

function isFileHandle(value: unknown): value is FileHandle {
  return typeof value === "object" && value !== null && "close" in value;
}

function abortedError(cause: unknown): GitSafePathOpenError {
  return new GitSafePathOpenError("aborted", "Git 文件读取已取消", { cause });
}
