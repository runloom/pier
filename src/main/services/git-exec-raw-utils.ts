import {
  GIT_EXEC_DEFAULT_MAX_NUL_RECORDS,
  GIT_EXEC_DIAGNOSTIC_TAIL_BYTES,
  GIT_EXEC_HARD_MAX_NUL_RECORDS,
  GIT_EXEC_MAX_NUL_RECORD_BYTES,
  GIT_EXEC_MAX_OUTPUT_BYTES,
  GIT_EXEC_MAX_TIMEOUT_MS,
  type GitExecFailureCause,
  GitExecRawError,
  type GitExecRawOptions,
} from "./git-exec-raw-contract.ts";

export const GIT_EXEC_DEFAULT_TIMEOUT_MS = 10_000;
export const GIT_EXEC_DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
export const GIT_EXEC_SIGKILL_GRACE_MS = 1500;
export const GIT_EXEC_FORCE_SETTLE_GRACE_MS = 250;

export const GIT_EXEC_ENV: Readonly<Record<string, string>> = {
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  LANG: "C",
  LC_ALL: "C",
};

const HOOK_SIGNAL_MARKER = " died of signal ";

export function createGitExecImmediateError(
  args: readonly string[],
  options: GitExecRawOptions,
  causeKind: GitExecFailureCause,
  message: string
): GitExecRawError {
  return new GitExecRawError({
    args,
    causeKind,
    cwd: options.cwd,
    exitCode: null,
    message,
    stderrBytes: 0,
    stderrTail: Buffer.alloc(0),
    stdoutBytes: 0,
    stdoutTail: Buffer.alloc(0),
  });
}

export function getGitExecConfigurationError(
  options: GitExecRawOptions
): string | null {
  const positiveLimits: ReadonlyArray<readonly [string, number | undefined]> = [
    ["maxOutputBytes", options.maxOutputBytes],
    ["timeoutMs", options.timeoutMs],
    [
      "maxRecordBytes",
      options.mode === "stream" ? options.maxRecordBytes : undefined,
    ],
    [
      "maxRecords",
      options.mode === "stream" ? (options.maxRecords ?? undefined) : undefined,
    ],
  ];
  for (const [name, value] of positiveLimits) {
    if (value !== undefined && !(Number.isSafeInteger(value) && value > 0)) {
      return `${name} 必须是正安全整数`;
    }
  }
  const maxOutputBytes = getGitExecMaxOutputBytes(options);
  if (maxOutputBytes > GIT_EXEC_MAX_OUTPUT_BYTES) {
    return `maxOutputBytes 不得超过 ${GIT_EXEC_MAX_OUTPUT_BYTES}`;
  }
  if (
    options.mode === "stream" &&
    (options.maxRecordBytes ?? GIT_EXEC_MAX_NUL_RECORD_BYTES) >
      GIT_EXEC_MAX_NUL_RECORD_BYTES
  ) {
    return `maxRecordBytes 不得超过 ${GIT_EXEC_MAX_NUL_RECORD_BYTES}`;
  }
  if (
    options.mode === "stream" &&
    options.maxRecords !== null &&
    (options.maxRecords ?? GIT_EXEC_DEFAULT_MAX_NUL_RECORDS) >
      GIT_EXEC_HARD_MAX_NUL_RECORDS
  ) {
    return `maxRecords 不得超过 ${GIT_EXEC_HARD_MAX_NUL_RECORDS}`;
  }
  if (
    options.mode === "stream" &&
    options.maxRecords === null &&
    options.budget === undefined
  ) {
    return "maxRecords=null 必须提供聚合执行预算";
  }
  if (
    options.timeoutMs !== undefined &&
    options.timeoutMs > GIT_EXEC_MAX_TIMEOUT_MS
  ) {
    return `timeoutMs 不得超过 ${GIT_EXEC_MAX_TIMEOUT_MS}`;
  }
  if (
    options.deadlineAtMs !== undefined &&
    !Number.isSafeInteger(options.deadlineAtMs)
  ) {
    return "deadlineAtMs 必须是安全整数时间戳";
  }
  if (
    options.deadlineAtMs !== undefined &&
    options.deadlineAtMs - Date.now() > GIT_EXEC_MAX_TIMEOUT_MS
  ) {
    return `deadlineAtMs 距当前时间不得超过 ${GIT_EXEC_MAX_TIMEOUT_MS}ms`;
  }
  return null;
}

/**
 * 普通 raw/text 命令保留历史 16 MiB 默认值；公开 Git Review 请求传入
 * 聚合预算后，由预算持有跨子命令累计上限，单命令只受 64 MiB raw 硬门约束。
 */
export function getGitExecMaxOutputBytes(options: GitExecRawOptions): number {
  return (
    options.maxOutputBytes ??
    (options.budget === undefined
      ? GIT_EXEC_DEFAULT_MAX_OUTPUT_BYTES
      : GIT_EXEC_MAX_OUTPUT_BYTES)
  );
}

export function getGitExecInitialAbortMessage(
  reason: GitExecFailureCause | null | undefined
): string {
  if (reason === "timeout") {
    return "git 执行期限已到";
  }
  if (reason === "output-limit") {
    return "git 请求输出预算已耗尽";
  }
  return "git 执行在启动前已取消";
}

export class GitExecTailBuffer {
  readonly #buffer: Buffer;
  #length = 0;
  #writeOffset = 0;

  constructor(limit = GIT_EXEC_DIAGNOSTIC_TAIL_BYTES) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new RangeError("Git diagnostic tail limit must be positive");
    }
    this.#buffer = Buffer.allocUnsafe(limit);
  }

  append(chunk: Buffer): void {
    if (chunk.length >= this.#buffer.length) {
      chunk.copy(
        this.#buffer,
        0,
        chunk.length - this.#buffer.length,
        chunk.length
      );
      this.#length = this.#buffer.length;
      this.#writeOffset = 0;
      return;
    }
    const firstLength = Math.min(
      chunk.length,
      this.#buffer.length - this.#writeOffset
    );
    chunk.copy(this.#buffer, this.#writeOffset, 0, firstLength);
    const remaining = chunk.length - firstLength;
    if (remaining > 0) {
      chunk.copy(this.#buffer, 0, firstLength);
    }
    this.#writeOffset =
      (this.#writeOffset + chunk.length) % this.#buffer.length;
    this.#length = Math.min(this.#buffer.length, this.#length + chunk.length);
  }

  toBuffer(): Buffer {
    if (this.#length < this.#buffer.length) {
      return Buffer.from(this.#buffer.subarray(0, this.#length));
    }
    return Buffer.concat([
      this.#buffer.subarray(this.#writeOffset),
      this.#buffer.subarray(0, this.#writeOffset),
    ]);
  }
}

export function parseGitHookSignal(
  stderr: string
): { hookPath: string; signal: number } | null {
  let searchFrom = 0;
  while (searchFrom < stderr.length) {
    const markerIndex = stderr.indexOf(HOOK_SIGNAL_MARKER, searchFrom);
    if (markerIndex === -1) {
      return null;
    }
    let pathStart = markerIndex;
    while (pathStart > 0 && !/\s/u.test(stderr[pathStart - 1] ?? "")) {
      pathStart -= 1;
    }
    const hookPath = stderr.slice(pathStart, markerIndex);
    const signalStart = markerIndex + HOOK_SIGNAL_MARKER.length;
    let signalEnd = signalStart;
    while (/\d/u.test(stderr[signalEnd] ?? "")) {
      signalEnd += 1;
    }
    if (hookPath.length > 0 && signalEnd > signalStart) {
      return {
        hookPath,
        signal: Number.parseInt(stderr.slice(signalStart, signalEnd), 10),
      };
    }
    searchFrom = markerIndex + HOOK_SIGNAL_MARKER.length;
  }
  return null;
}

export function getEffectiveTimeoutMs(options: {
  deadlineAtMs?: number;
  timeoutMs?: number;
}): number {
  const timeoutMs = options.timeoutMs ?? GIT_EXEC_DEFAULT_TIMEOUT_MS;
  if (options.deadlineAtMs === undefined) {
    return timeoutMs;
  }
  return Math.min(timeoutMs, Math.max(0, options.deadlineAtMs - Date.now()));
}
