import { spawn as nodeSpawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { GitExecNulRecordParser } from "./git-exec-nul-record-parser.ts";
import {
  type CreateExecGitRawOptions,
  type ExecGitRaw,
  GIT_EXEC_DEFAULT_MAX_NUL_RECORDS,
  GIT_EXEC_MAX_STDIN_BYTES,
  GIT_EXEC_MAX_TIMEOUT_MS,
  type GitExecFailureCause,
  GitExecRawError,
} from "./git-exec-raw-contract.ts";
import {
  createGitExecImmediateError,
  GIT_EXEC_ENV,
  GIT_EXEC_FORCE_SETTLE_GRACE_MS,
  GIT_EXEC_SIGKILL_GRACE_MS,
  GitExecTailBuffer,
  getEffectiveTimeoutMs,
  getGitExecConfigurationError,
  getGitExecInitialAbortMessage,
  getGitExecMaxOutputBytes,
  parseGitHookSignal,
} from "./git-exec-raw-utils.ts";

/** 唯一 Git spawn 底座：文本执行器只允许包装此 raw core。 */
export function createExecGitRaw({
  spawn = nodeSpawn,
}: CreateExecGitRawOptions = {}): ExecGitRaw {
  return function execGitRaw(args, options) {
    const configurationError = getGitExecConfigurationError(options);
    if (configurationError !== null) {
      return Promise.reject(
        createGitExecImmediateError(
          args,
          options,
          "configuration",
          configurationError
        )
      );
    }
    if (options.signal?.aborted || options.budget?.signal.aborted) {
      const budgetReason = options.budget?.failureReason();
      return Promise.reject(
        createGitExecImmediateError(
          args,
          options,
          budgetReason ?? "aborted",
          getGitExecInitialAbortMessage(budgetReason)
        )
      );
    }
    if ((options.stdin?.length ?? 0) > GIT_EXEC_MAX_STDIN_BYTES) {
      return Promise.reject(
        createGitExecImmediateError(
          args,
          options,
          "stdin-limit",
          `git stdin 超过字节上限(${GIT_EXEC_MAX_STDIN_BYTES} bytes)`
        )
      );
    }
    let preparedParser: GitExecNulRecordParser | null = null;
    if (options.mode === "stream") {
      try {
        preparedParser = new GitExecNulRecordParser(options.maxRecordBytes);
      } catch (error) {
        return Promise.reject(
          createGitExecImmediateError(
            args,
            options,
            "configuration",
            error instanceof Error ? error.message : String(error)
          )
        );
      }
    }
    const startedAtMs = Date.now();
    const executionDeadlineAt =
      options.budget === undefined
        ? startedAtMs + getEffectiveTimeoutMs(options)
        : Math.min(
            options.deadlineAtMs ?? Number.POSITIVE_INFINITY,
            options.timeoutMs === undefined
              ? Number.POSITIVE_INFINITY
              : startedAtMs + options.timeoutMs
          );
    if (executionDeadlineAt <= Date.now()) {
      return Promise.reject(
        createGitExecImmediateError(
          args,
          options,
          "timeout",
          "git 执行期限已到"
        )
      );
    }

    return new Promise((resolve, reject) => {
      const maxOutputBytes = getGitExecMaxOutputBytes(options);
      let child: ReturnType<typeof nodeSpawn>;
      try {
        child = spawn("git", [...args], {
          cwd: options.cwd,
          env: { ...process.env, ...(options.env ?? {}), ...GIT_EXEC_ENV },
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        reject(
          createGitExecImmediateError(
            args,
            options,
            "spawn-error",
            `git 无法启动: ${error instanceof Error ? error.message : String(error)}`
          )
        );
        return;
      }

      const stdoutChunks: Buffer[] = [];
      const parser = preparedParser;
      const stdoutTail = new GitExecTailBuffer();
      const stderrTail = new GitExecTailBuffer();
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let completeRecords = 0;
      let stopped = false;
      let settled = false;
      let failure:
        | { causeKind: GitExecFailureCause; message: string }
        | undefined;
      let killEscalationTimer: NodeJS.Timeout | undefined;
      let forceSettleTimer: NodeJS.Timeout | undefined;
      let timeout: NodeJS.Timeout | undefined;
      let hookSignal: { hookPath: string; signal: number } | null = null;
      let hookScanCarry = "";
      const hookDecoder = new StringDecoder("utf8");
      const signalsAreShared =
        options.signal !== undefined &&
        options.signal === options.budget?.signal;

      const abort = (): void => {
        fail("aborted", "git 执行已取消");
      };
      if (!signalsAreShared) {
        options.signal?.addEventListener("abort", abort, { once: true });
      }
      const budgetAbort = (): void => {
        const reason = options.budget?.failureReason();
        fail(reason ?? "aborted", `git 请求预算终止: ${reason ?? "aborted"}`);
      };
      options.budget?.signal.addEventListener("abort", budgetAbort, {
        once: true,
      });

      function forceKill(signal: "SIGKILL" | "SIGTERM"): void {
        try {
          child.kill(signal);
        } catch {
          // kill 抛错不能制造第二个终态；最终 watchdog 仍会有界结算。
        }
        if (settled) {
          return;
        }
        if (signal === "SIGTERM" && killEscalationTimer === undefined) {
          killEscalationTimer = setTimeout(() => {
            if (!settled) {
              forceKill("SIGKILL");
            }
          }, GIT_EXEC_SIGKILL_GRACE_MS);
        }
        if (signal === "SIGKILL" && forceSettleTimer === undefined) {
          forceSettleTimer = setTimeout(() => {
            settleTerminatedWithoutClose();
          }, GIT_EXEC_FORCE_SETTLE_GRACE_MS);
        }
      }

      function fail(causeKind: GitExecFailureCause, message: string): void {
        if (failure !== undefined || settled || stopped) {
          return;
        }
        failure = { causeKind, message };
        child.stdin?.destroy();
        forceKill("SIGTERM");
      }

      function cleanup(): void {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        if (killEscalationTimer !== undefined) {
          clearTimeout(killEscalationTimer);
        }
        if (forceSettleTimer !== undefined) {
          clearTimeout(forceSettleTimer);
        }
        if (!signalsAreShared) {
          options.signal?.removeEventListener("abort", abort);
        }
        options.budget?.signal.removeEventListener("abort", budgetAbort);
      }

      function rejectFailure(
        causeKind: GitExecFailureCause,
        message: string,
        exitCode: number | null,
        signal: NodeJS.Signals | null = null
      ): void {
        settled = true;
        cleanup();
        const stderrTailBuffer = stderrTail.toBuffer();
        reject(
          new GitExecRawError({
            args,
            causeKind,
            cwd: options.cwd,
            exitCode,
            hookSignal,
            message,
            signal,
            stderrBytes,
            stderrTail: stderrTailBuffer,
            stdoutBytes,
            stdoutTail: stdoutTail.toBuffer(),
          })
        );
      }

      function resolveTruncated(): void {
        settled = true;
        cleanup();
        resolve({
          completeRecords,
          kind: "truncated",
          stderrBytes,
          stderrTail: stderrTail.toBuffer(),
          stdoutBytes,
        });
      }

      function settleTerminatedWithoutClose(): void {
        if (settled) {
          return;
        }
        child.stdin?.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();
        if (failure !== undefined) {
          rejectFailure(failure.causeKind, failure.message, null);
          return;
        }
        if (stopped) {
          resolveTruncated();
        }
      }

      function scheduleTimeout(): void {
        if (failure !== undefined || settled || stopped) {
          return;
        }
        const localRemaining = executionDeadlineAt - Date.now();
        if (localRemaining <= 0) {
          fail("timeout", "git 执行期限已到");
          return;
        }
        const budgetRemaining =
          options.budget?.remainingTimeMs() ?? Number.POSITIVE_INFINITY;
        if (options.budget?.signal.aborted) {
          budgetAbort();
          return;
        }
        const nextDelay = Math.min(localRemaining, budgetRemaining);
        if (nextDelay <= 0) {
          budgetAbort();
          return;
        }
        if (!Number.isFinite(nextDelay)) {
          return;
        }
        timeout = setTimeout(
          () => {
            timeout = undefined;
            scheduleTimeout();
          },
          Math.min(GIT_EXEC_MAX_TIMEOUT_MS, Math.max(1, nextDelay))
        );
      }

      function trackOutput(chunkBytes: number, totalBytes: number): void {
        const budgetDecision = options.budget?.consumeOutputBytes(chunkBytes);
        if (budgetDecision !== undefined && budgetDecision !== "ok") {
          fail(budgetDecision, `git 请求输出预算终止: ${budgetDecision}`);
          return;
        }
        if (stdoutBytes + stderrBytes > maxOutputBytes) {
          fail(
            "output-limit",
            `git 输出超过字节上限(${maxOutputBytes} bytes，已接收 ${totalBytes} bytes)`
          );
        }
      }

      child.stdout?.on("data", (chunk: Buffer) => {
        if (settled || stopped) {
          return;
        }
        stdoutBytes += chunk.length;
        stdoutTail.append(chunk);
        trackOutput(chunk.length, stdoutBytes + stderrBytes);
        if (failure !== undefined) {
          return;
        }
        if (options.mode === "collect") {
          stdoutChunks.push(Buffer.from(chunk));
          return;
        }
        if (options.mode === "chunks") {
          try {
            options.onStdoutChunk(chunk);
          } catch (error) {
            fail(
              "record-consumer",
              `Git stdout consumer 失败: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
          return;
        }
        try {
          parser?.push(chunk, (record) => {
            completeRecords += 1;
            let decision: "continue" | "stop";
            try {
              decision = options.onRecord(record);
            } catch (error) {
              fail(
                "record-consumer",
                `Git record consumer 失败: ${
                  error instanceof Error ? error.message : String(error)
                }`
              );
              return false;
            }
            const maxRecords =
              options.maxRecords === null
                ? null
                : (options.maxRecords ?? GIT_EXEC_DEFAULT_MAX_NUL_RECORDS);
            if (
              decision === "stop" ||
              (maxRecords !== null && completeRecords >= maxRecords)
            ) {
              stopped = true;
              forceKill("SIGTERM");
              return false;
            }
            return true;
          });
        } catch (error) {
          fail(
            "record-limit",
            error instanceof Error ? error.message : String(error)
          );
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        if (settled || stopped) {
          return;
        }
        stderrBytes += chunk.length;
        stderrTail.append(chunk);
        if (hookSignal === null) {
          const scanText = hookScanCarry + hookDecoder.write(chunk);
          hookSignal = parseGitHookSignal(scanText);
          hookScanCarry = scanText.slice(-4096);
        }
        trackOutput(chunk.length, stdoutBytes + stderrBytes);
      });

      child.stdout?.on("error", (error: Error) => {
        fail("stream-error", `stdout: ${error.message}`);
      });
      child.stderr?.on("error", (error: Error) => {
        fail("stream-error", `stderr: ${error.message}`);
      });
      child.stdin?.on("error", (error: Error) => {
        fail("stdin-error", `stdin: ${error.message}`);
      });

      child.on("error", (error: Error) => {
        if (settled || failure !== undefined || stopped) {
          return;
        }
        rejectFailure("spawn-error", `git 无法启动: ${error.message}`, null);
      });

      child.on(
        "close",
        (code: number | null, rawSignal?: NodeJS.Signals | null) => {
          const signal = rawSignal ?? null;
          if (settled) {
            return;
          }
          if (failure !== undefined) {
            rejectFailure(failure.causeKind, failure.message, code, signal);
            return;
          }
          if (stopped) {
            resolveTruncated();
            return;
          }
          if (code !== 0 || signal !== null) {
            const exitDescription =
              signal === null ? `退出码 ${code}` : `被信号 ${signal} 终止`;
            rejectFailure(
              "exit",
              `git ${exitDescription}: ${stderrTail.toBuffer().toString("utf8").trim()}`,
              code,
              signal
            );
            return;
          }
          if (options.mode === "stream" && parser?.hasIncompleteRecord) {
            rejectFailure(
              "incomplete-record",
              "git NUL 输出以不完整 record 结束",
              code
            );
            return;
          }
          settled = true;
          cleanup();
          if (options.mode === "stream") {
            resolve({
              completeRecords,
              kind: "streamed",
              stderrBytes,
              stderrTail: stderrTail.toBuffer(),
              stdoutBytes,
            });
            return;
          }
          if (options.mode === "chunks") {
            resolve({
              kind: "consumed",
              stderrBytes,
              stderrTail: stderrTail.toBuffer(),
              stdoutBytes,
            });
            return;
          }
          resolve({
            kind: "collected",
            stderrBytes,
            stderrTail: stderrTail.toBuffer(),
            stdout: Buffer.concat(stdoutChunks, stdoutBytes),
            stdoutBytes,
          });
        }
      );

      if (options.budget?.signal.aborted) {
        budgetAbort();
      } else if (options.signal?.aborted) {
        abort();
      } else {
        scheduleTimeout();
      }

      if (child.stdin != null && failure === undefined && !stopped) {
        try {
          if (options.stdin === undefined) {
            child.stdin.end();
          } else if (child.stdin.write(options.stdin)) {
            child.stdin.end();
          } else {
            child.stdin.once("drain", () => {
              if (failure === undefined && !settled && !stopped) {
                child.stdin?.end();
              }
            });
          }
        } catch (error) {
          fail(
            "stdin-error",
            `stdin: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    });
  };
}

export const execGitRaw = createExecGitRaw();
