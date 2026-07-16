import type { spawn as nodeSpawn } from "node:child_process";

export const GIT_EXEC_DIAGNOSTIC_TAIL_BYTES = 64 * 1024;
export const GIT_EXEC_MAX_STDIN_BYTES = 8 * 1024 * 1024;
export const GIT_EXEC_MAX_NUL_RECORD_BYTES = 1024 * 1024;
export const GIT_EXEC_DEFAULT_MAX_NUL_RECORDS = 2000;
export const GIT_EXEC_HARD_MAX_NUL_RECORDS = 8192;
export const GIT_EXEC_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/** Node.js setTimeout 可安全接纳的最大延迟。 */
export const GIT_EXEC_MAX_TIMEOUT_MS = 2_147_483_647;

export type GitExecFailureCause =
  | "aborted"
  | "configuration"
  | "exit"
  | "incomplete-record"
  | "output-limit"
  | "record-consumer"
  | "record-limit"
  | "spawn-error"
  | "stdin-error"
  | "stdin-limit"
  | "stream-error"
  | "timeout";

export type GitExecRecordDecision = "continue" | "stop";

export interface GitExecExecutionBudget {
  consumeOutputBytes(delta: number): "ok" | "output-limit" | "timeout";
  failureReason(): "output-limit" | "timeout" | null;
  remainingTimeMs(): number;
  readonly signal: AbortSignal;
  trackDetachedOperation?(operation: Promise<unknown>): void;
}

interface GitExecRawOptionsBase {
  budget?: GitExecExecutionBudget;
  cwd: string;
  deadlineAtMs?: number;
  env?: Readonly<Record<string, string>>;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  stdin?: Buffer;
  timeoutMs?: number;
}

export interface GitExecRawCollectOptions extends GitExecRawOptionsBase {
  mode: "collect";
}

export interface GitExecRawStreamOptions extends GitExecRawOptionsBase {
  maxRecordBytes?: number;
  /** null 表示只受聚合输出字节、单 record 字节和期限约束。 */
  maxRecords?: number | null;
  mode: "stream";
  onRecord: (record: Buffer) => GitExecRecordDecision;
}

export interface GitExecRawChunkOptions extends GitExecRawOptionsBase {
  mode: "chunks";
  onStdoutChunk: (chunk: Buffer) => void;
}

export type GitExecRawOptions =
  | GitExecRawCollectOptions
  | GitExecRawStreamOptions
  | GitExecRawChunkOptions;

interface GitExecRawResultBase {
  stderrBytes: number;
  stderrTail: Buffer;
  stdoutBytes: number;
}

export type GitExecRawResult =
  | (GitExecRawResultBase & {
      kind: "collected";
      stdout: Buffer;
    })
  | (GitExecRawResultBase & {
      completeRecords: number;
      kind: "streamed";
    })
  | (GitExecRawResultBase & {
      completeRecords: number;
      kind: "truncated";
    })
  | (GitExecRawResultBase & {
      kind: "consumed";
    });

export interface CreateExecGitRawOptions {
  spawn?: typeof nodeSpawn;
}

export class GitExecRawError extends Error {
  readonly args: readonly string[];
  readonly causeKind: GitExecFailureCause;
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly hookSignal: { hookPath: string; signal: number } | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderrBytes: number;
  readonly stderrTail: Buffer;
  readonly stdoutBytes: number;
  readonly stdoutTail: Buffer;

  constructor(options: {
    args: readonly string[];
    causeKind: GitExecFailureCause;
    cwd: string;
    exitCode: number | null;
    hookSignal?: { hookPath: string; signal: number } | null;
    message: string;
    signal?: NodeJS.Signals | null;
    stderrBytes: number;
    stderrTail: Buffer;
    stdoutBytes: number;
    stdoutTail: Buffer;
  }) {
    super(options.message);
    this.name = "GitExecRawError";
    this.args = options.args;
    this.causeKind = options.causeKind;
    this.cwd = options.cwd;
    this.exitCode = options.exitCode;
    this.hookSignal = options.hookSignal ?? null;
    this.signal = options.signal ?? null;
    this.stderrBytes = options.stderrBytes;
    this.stderrTail = Buffer.from(options.stderrTail);
    this.stdoutBytes = options.stdoutBytes;
    this.stdoutTail = Buffer.from(options.stdoutTail);
  }
}

export type ExecGitRaw = (
  args: readonly string[],
  options: GitExecRawOptions
) => Promise<GitExecRawResult>;
