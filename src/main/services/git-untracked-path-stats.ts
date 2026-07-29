import { type FileHandle, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";
import type { GitChangeSummaryUnavailableReason } from "../../shared/contracts/git-change-summary.ts";
import type { GitExecExecutionBudget } from "./git-exec-raw-contract.ts";
import {
  GitSafePathOpenError,
  openGitPathNoSymlinks,
} from "./git-safe-path-open.ts";

export const GIT_CHANGE_SUMMARY_FILE_BYTES = 8 * 1024 * 1024;
export const GIT_CHANGE_SUMMARY_TOTAL_BYTES = 16 * 1024 * 1024;
export const GIT_CHANGE_SUMMARY_READ_CONCURRENCY = 8;
export const GIT_CHANGE_SUMMARY_READ_TIMEOUT_MS = 1500;

export type GitUntrackedFileInspector = (path: string) => Promise<number>;
export type GitUntrackedFileReader = (path: string) => Promise<Buffer>;

export interface GitUntrackedPathStats {
  readonly excludedFiles: number;
  readonly insertions: number;
  readonly omittedFiles: number;
  readonly reasons: readonly GitChangeSummaryUnavailableReason[];
  readonly stableStatTokens?: ReadonlyMap<string, string>;
}

export interface ReadGitUntrackedPathStatsOptions {
  readonly budget?: GitExecExecutionBudget;
  readonly cwd: string;
  readonly inspectUntrackedFile?: GitUntrackedFileInspector;
  readonly paths: readonly string[];
  readonly readUntrackedFile?: GitUntrackedFileReader;
  readonly signal?: AbortSignal;
}

interface ReadTextResult {
  readonly kind: "text";
  readonly lines: number;
  readonly stableStatToken?: string;
}
interface ReadBinaryResult {
  readonly kind: "binary";
  readonly stableStatToken?: string;
}
interface ReadFailureResult {
  readonly kind: "failure";
  readonly reason: GitChangeSummaryUnavailableReason;
  readonly stableStatToken?: string;
}
type ReadResult = ReadTextResult | ReadBinaryResult | ReadFailureResult;

class SummaryTimeoutError extends Error {
  constructor() {
    super("summary read timeout");
    this.name = "SummaryTimeoutError";
  }
}

class SummaryDeadline {
  readonly #controller = new AbortController();
  readonly #externalAborts: readonly {
    readonly listener: () => void;
    readonly signal: AbortSignal;
  }[];
  readonly #timer: ReturnType<typeof setTimeout>;

  constructor(
    timeoutMs: number,
    control: Pick<ReadGitUntrackedPathStatsOptions, "budget" | "signal">
  ) {
    const signals = new Set<AbortSignal>();
    if (control.signal !== undefined) signals.add(control.signal);
    if (control.budget !== undefined) signals.add(control.budget.signal);
    this.#externalAborts = [...signals].map((signal) => {
      const listener = (): void => this.#controller.abort("request-aborted");
      signal.addEventListener("abort", listener, { once: true });
      if (signal.aborted) listener();
      return { listener, signal };
    });
    const effectiveTimeoutMs = Math.min(
      timeoutMs,
      control.budget?.remainingTimeMs() ?? timeoutMs
    );
    if (effectiveTimeoutMs <= 0) this.#controller.abort("timeout");
    this.#timer = setTimeout(
      () => this.#controller.abort("timeout"),
      Math.max(0, effectiveTimeoutMs)
    );
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }
  dispose(): void {
    clearTimeout(this.#timer);
    for (const { listener, signal } of this.#externalAborts)
      signal.removeEventListener("abort", listener);
  }
  async race<T>(operation: Promise<T>): Promise<T> {
    if (this.signal.aborted) throw new SummaryTimeoutError();
    return new Promise<T>((resolve, reject) => {
      const abort = (): void => reject(new SummaryTimeoutError());
      this.signal.addEventListener("abort", abort, { once: true });
      operation.then(
        (value) => {
          this.signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error: unknown) => {
          this.signal.removeEventListener("abort", abort);
          reject(error);
        }
      );
    });
  }
}

function isSafeRepoPath(path: string): boolean {
  if (path.length === 0 || path.includes("\0") || isAbsolute(path))
    return false;
  return !path
    .split("/")
    .some((part) => part === "" || part === "." || part === "..");
}

function isWithin(root: string, target: string): boolean {
  const relation = relative(root, target);
  return (
    relation === "" ||
    !(
      relation === ".." ||
      relation.startsWith(`..${sep}`) ||
      isAbsolute(relation)
    )
  );
}

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  let count = text.endsWith("\n") ? 0 : 1;
  for (let index = 0; index < text.length; index += 1)
    if (text.charCodeAt(index) === 10) count += 1;
  return count;
}

export function gitChangeSummaryStatToken(stat: {
  readonly ctimeNs: bigint;
  readonly dev: bigint;
  readonly ino: bigint;
  readonly mode: bigint;
  readonly mtimeNs: bigint;
  readonly size: bigint;
}): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.mode}`;
}

export async function closeGitChangeSummaryFileHandle(
  handle: Pick<FileHandle, "close">,
  signal: AbortSignal
): Promise<void> {
  const close = handle.close();
  if (signal.aborted) {
    close.catch(() => undefined);
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    const abort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      close.catch(() => undefined);
      resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
    close.then(
      () => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve();
        }
      },
      () => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve();
        }
      }
    );
    if (signal.aborted) abort();
  });
}

function classifyText(bytes: Buffer): ReadResult {
  if (bytes.includes(0)) return { kind: "binary" };
  try {
    return {
      kind: "text",
      lines: lineCount(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    };
  } catch {
    return { kind: "failure", reason: "invalidEncoding" };
  }
}

async function readBoundedFile(
  handle: FileHandle,
  size: number,
  deadline: SummaryDeadline
): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await deadline.race(
      handle.read(bytes, offset, size - offset, offset)
    );
    if (bytesRead === 0)
      throw new Error("summary file truncated while reading");
    offset += bytesRead;
  }
  const probe = Buffer.alloc(1);
  if ((await deadline.race(handle.read(probe, 0, 1, size))).bytesRead !== 0)
    throw new Error("summary file grew while reading");
  return bytes;
}

function mapReadFailure(error: unknown): ReadFailureResult {
  if (error instanceof SummaryTimeoutError)
    return { kind: "failure", reason: "timeout" };
  if (error instanceof GitSafePathOpenError) {
    if (error.reason === "aborted")
      return { kind: "failure", reason: "timeout" };
    if (error.reason === "unsupported")
      return { kind: "failure", reason: "readFailed" };
    return { kind: "failure", reason: "unsafePath" };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ELOOP"
  )
    return { kind: "failure", reason: "unsafePath" };
  return { kind: "failure", reason: "readFailed" };
}

async function readSafeUntrackedFile(
  cwd: string,
  path: string,
  deadline: SummaryDeadline,
  reserveBytes: (size: number) => "ok" | "budgetExceeded",
  budget?: GitExecExecutionBudget
): Promise<ReadResult> {
  if (!isSafeRepoPath(path)) return { kind: "failure", reason: "unsafePath" };
  let handle: FileHandle | undefined;
  try {
    const canonicalRoot = await deadline.race(realpath(cwd));
    const target = resolve(canonicalRoot, path);
    if (!isWithin(canonicalRoot, target))
      return { kind: "failure", reason: "unsafePath" };
    handle = await openGitPathNoSymlinks({
      canonicalRoot,
      onDetachedOperation: (operation) =>
        budget?.trackDetachedOperation?.(operation),
      segments: path.split("/"),
      signal: deadline.signal,
      target,
    });
    const before = await deadline.race(handle.stat({ bigint: true }));
    if (!before.isFile()) return { kind: "failure", reason: "readFailed" };
    if (before.size > BigInt(GIT_CHANGE_SUMMARY_FILE_BYTES))
      return { kind: "failure", reason: "tooLarge" };
    const size = Number(before.size);
    if (reserveBytes(size) !== "ok")
      return { kind: "failure", reason: "budgetExceeded" };
    const bytes = await readBoundedFile(handle, size, deadline);
    const after = await deadline.race(handle.stat({ bigint: true }));
    if (gitChangeSummaryStatToken(before) !== gitChangeSummaryStatToken(after))
      return { kind: "failure", reason: "readFailed" };
    return {
      ...classifyText(bytes),
      stableStatToken: gitChangeSummaryStatToken(after),
    };
  } catch (error) {
    return mapReadFailure(error);
  } finally {
    if (handle !== undefined)
      await closeGitChangeSummaryFileHandle(handle, deadline.signal);
  }
}

export async function readGitUntrackedPathStats(
  options: ReadGitUntrackedPathStatsOptions
): Promise<GitUntrackedPathStats> {
  const {
    budget,
    cwd,
    inspectUntrackedFile,
    paths,
    readUntrackedFile,
    signal,
  } = options;
  const deadline = new SummaryDeadline(GIT_CHANGE_SUMMARY_READ_TIMEOUT_MS, {
    ...(budget === undefined ? {} : { budget }),
    ...(signal === undefined ? {} : { signal }),
  });
  let cursor = 0,
    reservedBytes = 0,
    excludedFiles = 0,
    insertions = 0,
    omittedFiles = 0;
  const reasons: GitChangeSummaryUnavailableReason[] = [];
  const stableStatTokens = new Map<string, string>();
  const reserveBytes = (size: number): "ok" | "budgetExceeded" => {
    if (reservedBytes + size > GIT_CHANGE_SUMMARY_TOTAL_BYTES)
      return "budgetExceeded";
    reservedBytes += size;
    return "ok";
  };
  const worker = async (): Promise<void> => {
    while (true) {
      const path = paths[cursor++];
      if (path === undefined) return;
      let result: ReadResult;
      if (readUntrackedFile === undefined)
        result = await readSafeUntrackedFile(
          cwd,
          path,
          deadline,
          reserveBytes,
          budget
        );
      else if (isSafeRepoPath(path))
        try {
          if (inspectUntrackedFile === undefined) {
            const bytes = await deadline.race(readUntrackedFile(path));
            if (bytes.length > GIT_CHANGE_SUMMARY_FILE_BYTES) {
              result = { kind: "failure", reason: "tooLarge" };
            } else if (reserveBytes(bytes.length) === "ok") {
              result = classifyText(bytes);
            } else {
              result = { kind: "failure", reason: "budgetExceeded" };
            }
          } else {
            const size = await deadline.race(inspectUntrackedFile(path));
            if (!Number.isSafeInteger(size) || size < 0)
              result = { kind: "failure", reason: "readFailed" };
            else if (size > GIT_CHANGE_SUMMARY_FILE_BYTES)
              result = { kind: "failure", reason: "tooLarge" };
            else if (reserveBytes(size) === "ok")
              result = classifyText(
                await deadline.race(readUntrackedFile(path))
              );
            else result = { kind: "failure", reason: "budgetExceeded" };
          }
        } catch (error) {
          result = mapReadFailure(error);
        }
      else result = { kind: "failure", reason: "unsafePath" };
      if (result.kind === "failure") {
        omittedFiles += 1;
        reasons.push(result.reason);
      } else if (result.kind === "binary") excludedFiles += 1;
      else insertions += result.lines;
      if (result.stableStatToken !== undefined)
        stableStatTokens.set(path, result.stableStatToken);
    }
  };
  try {
    await Promise.all(
      Array.from(
        { length: Math.min(GIT_CHANGE_SUMMARY_READ_CONCURRENCY, paths.length) },
        worker
      )
    );
  } finally {
    deadline.dispose();
  }
  return {
    excludedFiles,
    insertions,
    omittedFiles,
    reasons,
    ...(stableStatTokens.size === 0 ? {} : { stableStatTokens }),
  };
}
