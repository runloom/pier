import { spawn as nodeSpawn } from "node:child_process";
import { createExecGitRaw } from "./git-exec-raw.ts";
import {
  type CreateExecGitRawOptions,
  type GitExecFailureCause,
  GitExecRawError,
  type GitExecRawResult,
} from "./git-exec-raw-contract.ts";
import { GIT_EXEC_DEFAULT_MAX_OUTPUT_BYTES } from "./git-exec-raw-utils.ts";

export {
  createExecGitRaw,
  execGitRaw,
} from "./git-exec-raw.ts";
export type {
  CreateExecGitRawOptions,
  ExecGitRaw,
  GitExecFailureCause,
  GitExecRawOptions,
  GitExecRawResult,
} from "./git-exec-raw-contract.ts";
export {
  GIT_EXEC_DEFAULT_MAX_NUL_RECORDS,
  GIT_EXEC_DIAGNOSTIC_TAIL_BYTES,
  GIT_EXEC_HARD_MAX_NUL_RECORDS,
  GIT_EXEC_MAX_NUL_RECORD_BYTES,
  GIT_EXEC_MAX_OUTPUT_BYTES,
  GIT_EXEC_MAX_STDIN_BYTES,
  GIT_EXEC_MAX_TIMEOUT_MS,
  GitExecRawError,
} from "./git-exec-raw-contract.ts";

/** 旧文本执行器的公共兼容错误；大输出字段现在只保留 64 KiB 尾部。 */
export class GitExecError extends Error {
  readonly args: readonly string[];
  readonly causeKind: GitExecFailureCause;
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly hookSignal: { hookPath: string; signal: number } | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly stderrBytes: number;
  readonly stderrTail: Buffer;
  readonly stdout: string;
  readonly stdoutBytes: number;
  readonly stdoutTail: Buffer;

  constructor(options: {
    args: readonly string[];
    causeKind?: GitExecFailureCause;
    cwd: string;
    exitCode: number | null;
    hookSignal?: { hookPath: string; signal: number } | null;
    message: string;
    signal?: NodeJS.Signals | null;
    stderr: string;
    stderrBytes?: number;
    stderrTail?: Buffer;
    stdout: string;
    stdoutBytes?: number;
    stdoutTail?: Buffer;
  }) {
    super(options.message);
    this.name = "GitExecError";
    this.args = options.args;
    this.causeKind = options.causeKind ?? "exit";
    this.cwd = options.cwd;
    this.exitCode = options.exitCode;
    this.hookSignal = options.hookSignal ?? null;
    this.signal = options.signal ?? null;
    this.stderr = options.stderr;
    this.stderrTail = Buffer.from(
      options.stderrTail ?? Buffer.from(options.stderr, "utf8")
    );
    this.stderrBytes = options.stderrBytes ?? this.stderrTail.length;
    this.stdout = options.stdout;
    this.stdoutTail = Buffer.from(
      options.stdoutTail ?? Buffer.from(options.stdout, "utf8")
    );
    this.stdoutBytes = options.stdoutBytes ?? this.stdoutTail.length;
  }
}

export interface GitExecOptions {
  budget?: import("./git-exec-raw-contract.ts").GitExecExecutionBudget;
  cwd: string;
  env?: Readonly<Record<string, string>>;
  /** stdout + stderr 累计字节上限（默认 16 MiB）。 */
  maxOutputBytes?: number;
  onSuccessStderr?: (stderr: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CreateExecGitOptions {
  /** spawn 替身。测试可注入 kill、stream error 与边界竞态。 */
  spawn?: typeof nodeSpawn;
}

/**
 * 旧文本签名的兼容适配器。spawn、timeout、输出限制和 kill 状态机全部由
 * createExecGitRaw 持有，此处只负责 UTF-8 解码与成功 stderr 回调。
 */
export function createExecGit({
  spawn = nodeSpawn,
}: CreateExecGitOptions = {}): (
  args: readonly string[],
  options: GitExecOptions
) => Promise<string> {
  const execRaw = createExecGitRaw({ spawn } satisfies CreateExecGitRawOptions);
  return async function execGit(args, options): Promise<string> {
    let result: GitExecRawResult;
    try {
      result = await execRaw(args, {
        ...(options.budget === undefined ? {} : { budget: options.budget }),
        cwd: options.cwd,
        ...(options.env === undefined ? {} : { env: options.env }),
        maxOutputBytes:
          options.maxOutputBytes ?? GIT_EXEC_DEFAULT_MAX_OUTPUT_BYTES,
        mode: "collect",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.timeoutMs === undefined
          ? {}
          : { timeoutMs: options.timeoutMs }),
      });
    } catch (error) {
      if (!(error instanceof GitExecRawError)) {
        throw error;
      }
      throw new GitExecError({
        args: error.args,
        causeKind: error.causeKind,
        cwd: error.cwd,
        exitCode: error.exitCode,
        hookSignal: error.hookSignal,
        message: error.message,
        signal: error.signal,
        stderr: error.stderrTail.toString("utf8"),
        stderrBytes: error.stderrBytes,
        stderrTail: error.stderrTail,
        stdout: error.stdoutTail.toString("utf8"),
        stdoutBytes: error.stdoutBytes,
        stdoutTail: error.stdoutTail,
      });
    }
    if (result.kind !== "collected") {
      throw new GitExecError({
        args,
        causeKind: "stream-error",
        cwd: options.cwd,
        exitCode: null,
        message: "文本 Git 执行器收到非 collect 结果",
        stderr: result.stderrTail.toString("utf8"),
        stderrBytes: result.stderrBytes,
        stderrTail: result.stderrTail,
        stdoutBytes: result.stdoutBytes,
        stdout: "",
        stdoutTail: Buffer.alloc(0),
      });
    }
    options.onSuccessStderr?.(result.stderrTail.toString("utf8"));
    return result.stdout.toString("utf8");
  };
}

export const execGit = createExecGit();
