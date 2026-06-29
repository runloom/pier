import { spawn as nodeSpawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
/**
 * SIGTERM 后等待子进程退出的宽限时间。超时后强制 SIGKILL，
 * 避免 git 在某些 lock 清理路径下忽略 SIGTERM 让 Promise 永挂。
 */
const SIGKILL_GRACE_MS = 1500;

/** git 子进程执行失败时的统一异常。保留完整 stdout/stderr/exitCode 便于上层错误分类。 */
export class GitExecError extends Error {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;

  constructor(options: {
    args: readonly string[];
    cwd: string;
    exitCode: number | null;
    message: string;
    stderr: string;
    stdout: string;
  }) {
    super(options.message);
    this.name = "GitExecError";
    this.args = options.args;
    this.cwd = options.cwd;
    this.exitCode = options.exitCode;
    this.stderr = options.stderr;
    this.stdout = options.stdout;
  }
}

export interface GitExecOptions {
  cwd: string;
  /** stdout + stderr 累计字节上限（默认 16MB）。按 chunk byteLength 累加，非 string.length。 */
  maxOutputBytes?: number;
  timeoutMs?: number;
}

export interface CreateExecGitOptions {
  /** spawn 替身。测试可注入 fake child 验证 SIGKILL fallback、stream error 等。 */
  spawn?: typeof nodeSpawn;
}

const GIT_ENV: Readonly<Record<string, string>> = {
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  LANG: "C",
  LC_ALL: "C",
};

/**
 * 工厂：返回与默认 `execGit` 同形态的函数，但 spawn 可注入用于测试。
 * 生产侧请直接 import 默认导出的 `execGit`；本工厂主要给单测用。
 */
export function createExecGit({
  spawn = nodeSpawn,
}: CreateExecGitOptions = {}): (
  args: readonly string[],
  options: GitExecOptions
) => Promise<string> {
  /**
   * 统一 spawn 原生 git 的底座。
   * 应用：超时（默认 10s）、输出字节上限（默认 16MB）、统一环境变量；失败 throw GitExecError。
   * 调用者拿到的是 stdout（保留原样，不 trim）。
   *
   * 实现要点：
   * - 用 StringDecoder 累积 Buffer chunks，避免 chunk 边界切断多字节 UTF-8 字符
   * - 字节计数按 chunk.length（== Buffer.byteLength），不按 string.length（code units）
   * - 超时/超限触发 SIGTERM；SIGKILL_GRACE_MS 后未退出再升级 SIGKILL
   * - stdout/stderr 的 "error" 事件累加到 streamErrors，settle 时合并进 GitExecError.message
   *   （而非 noop 吞，确保 EPIPE 等诊断信息不丢失）
   */
  return function execGit(args, options): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
      const child = spawn("git", [...args], {
        cwd: options.cwd,
        env: { ...process.env, ...GIT_ENV },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      const streamErrors: string[] = [];
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let exceededLimit = false;
      let timedOut = false;
      let settled = false;
      let killEscalationTimer: NodeJS.Timeout | null = null;

      const timer = setTimeout(() => {
        timedOut = true;
        forceKill("SIGTERM");
      }, timeoutMs);

      function forceKill(signal: "SIGTERM" | "SIGKILL"): void {
        child.kill(signal);
        if (signal === "SIGTERM" && killEscalationTimer === null) {
          killEscalationTimer = setTimeout(() => {
            if (!settled) {
              child.kill("SIGKILL");
            }
          }, SIGKILL_GRACE_MS);
        }
      }

      function appendStreamDiagnostics(base: string): string {
        if (streamErrors.length === 0) {
          return base;
        }
        return `${base} [stream errors: ${streamErrors.join("; ")}]`;
      }

      function settle(payload: {
        cause: "ok" | "exit" | "spawn-error" | "size-limit" | "timeout";
        exitCode: number | null;
        message?: string;
      }): void {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (killEscalationTimer !== null) {
          clearTimeout(killEscalationTimer);
        }
        // 把 decoder 内部 pending 字节冲洗出来
        stdout += stdoutDecoder.end();
        stderr += stderrDecoder.end();
        if (payload.cause === "ok" && streamErrors.length === 0) {
          resolve(stdout);
          return;
        }
        const reasonPrefix = (() => {
          if (payload.cause === "ok") {
            return "git 成功退出但 stream 有 error";
          }
          if (payload.cause === "spawn-error") {
            return "git 无法启动";
          }
          if (payload.cause === "size-limit") {
            return `git 输出超过字节上限(${maxOutputBytes} bytes)`;
          }
          if (payload.cause === "timeout") {
            return `git 执行超过 ${timeoutMs}ms 超时`;
          }
          return `git 退出码 ${payload.exitCode}`;
        })();
        const baseMessage =
          payload.message != null && payload.message.length > 0
            ? `${reasonPrefix}: ${payload.message}`
            : reasonPrefix;
        reject(
          new GitExecError({
            args,
            cwd: options.cwd,
            exitCode: payload.exitCode,
            message: appendStreamDiagnostics(baseMessage),
            stderr,
            stdout,
          })
        );
      }

      function trackChunkBytes(chunk: Buffer): boolean {
        if (exceededLimit) {
          return false;
        }
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) {
          exceededLimit = true;
          forceKill("SIGTERM");
          return false;
        }
        return true;
      }

      // stream "error" 累加到诊断字段(典型:EPIPE)。settle 时合并进 GitExecError.message
      child.stdout.on("error", (err: Error) => {
        streamErrors.push(`stdout: ${err.message}`);
      });
      child.stderr.on("error", (err: Error) => {
        streamErrors.push(`stderr: ${err.message}`);
      });

      child.stdout.on("data", (chunk: Buffer) => {
        if (!trackChunkBytes(chunk)) {
          return;
        }
        stdout += stdoutDecoder.write(chunk);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        if (!trackChunkBytes(chunk)) {
          return;
        }
        stderr += stderrDecoder.write(chunk);
      });

      child.on("error", (err) => {
        settle({ cause: "spawn-error", exitCode: null, message: err.message });
      });

      child.on("close", (code) => {
        if (exceededLimit) {
          settle({ cause: "size-limit", exitCode: code });
          return;
        }
        if (timedOut) {
          settle({ cause: "timeout", exitCode: code });
          return;
        }
        if (code === 0) {
          settle({ cause: "ok", exitCode: 0 });
          return;
        }
        settle({ cause: "exit", exitCode: code, message: stderr.trim() });
      });
    });
  };
}

/** 生产默认实现。下游 import 这个即可,行为与之前 export function execGit 等价。 */
export const execGit = createExecGit();
