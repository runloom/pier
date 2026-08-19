import {
  type ExecGitRaw,
  GitExecRawError,
  type GitExecRawOptions,
} from "./exec-raw-contract.ts";
import {
  createGitExecImmediateError,
  getGitExecInitialAbortMessage,
} from "./exec-raw-utils.ts";

/** Git lockfile.c：`Unable to create '…/index.lock': File exists.` */
const INDEX_LOCK_CREATE_MARKER = "Unable to create";
const INDEX_LOCK_FILE_MARKER = "index.lock";

export const GIT_INDEX_LOCK_RETRY_ATTEMPTS = 7;
export const GIT_INDEX_LOCK_RETRY_INITIAL_DELAY_MS = 20;

type GitIndexLockRetryWait = "aborted" | "continue" | "exhausted";

export function gitOutputHasIndexLock(
  ...parts: readonly (Buffer | string | undefined)[]
): boolean {
  return parts.some((part) => {
    if (part === undefined) {
      return false;
    }
    const text = typeof part === "string" ? part : part.toString("utf8");
    return (
      text.includes(INDEX_LOCK_CREATE_MARKER) &&
      text.includes(INDEX_LOCK_FILE_MARKER)
    );
  });
}

export function isGitIndexLockContention(error: unknown): boolean {
  if (error instanceof GitExecRawError) {
    return (
      error.causeKind === "exit" &&
      gitOutputHasIndexLock(error.message, error.stderrTail, error.stdoutTail)
    );
  }
  if (
    error instanceof Error &&
    error.name === "GitExecError" &&
    "causeKind" in error
  ) {
    const execError = error as Error & {
      causeKind: string;
      stderr?: string;
      stdout?: string;
      stderrTail?: Buffer;
      stdoutTail?: Buffer;
    };
    return (
      execError.causeKind === "exit" &&
      gitOutputHasIndexLock(
        execError.message,
        execError.stderr,
        execError.stdout,
        execError.stderrTail,
        execError.stdoutTail
      )
    );
  }
  return false;
}

/**
 * 对他人持有的 index.lock 做短重试。只包 spawn 一次的执行器，不进入状态机。
 * abort / timeout / 非锁失败立刻返回；下一跳超过剩余预算则停止（仍抛锁错误）。
 * 退避睡眠被取消时抛 aborted / timeout / output-limit，不伪装成锁争用。
 */
export function withGitIndexLockRetry(run: ExecGitRaw): ExecGitRaw {
  return async function execGitRawWithIndexLockRetry(args, options) {
    let delayMs = GIT_INDEX_LOCK_RETRY_INITIAL_DELAY_MS;
    let lastError: unknown;
    for (
      let attempt = 0;
      attempt < GIT_INDEX_LOCK_RETRY_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await run(args, options);
      } catch (error) {
        lastError = error;
        if (
          !isGitIndexLockContention(error) ||
          attempt === GIT_INDEX_LOCK_RETRY_ATTEMPTS - 1
        ) {
          throw error;
        }
        const wait = await waitForIndexLockRetry(delayMs, options);
        if (wait === "aborted") {
          throw gitIndexLockRetryAbortError(args, options);
        }
        if (wait === "exhausted") {
          throw error;
        }
        delayMs *= 2;
      }
    }
    throw lastError;
  };
}

function gitIndexLockRetryAbortError(
  args: readonly string[],
  options: GitExecRawOptions
): GitExecRawError {
  const budgetReason = options.budget?.failureReason();
  if (budgetReason === "timeout" || budgetReason === "output-limit") {
    return createGitExecImmediateError(
      args,
      options,
      budgetReason,
      getGitExecInitialAbortMessage(budgetReason)
    );
  }
  return createGitExecImmediateError(
    args,
    options,
    "aborted",
    "git 执行已取消"
  );
}

async function waitForIndexLockRetry(
  delayMs: number,
  options: GitExecRawOptions
): Promise<GitIndexLockRetryWait> {
  if (options.signal?.aborted || options.budget?.signal.aborted) {
    return "aborted";
  }
  const remaining =
    options.budget?.remainingTimeMs() ?? Number.POSITIVE_INFINITY;
  if (!(delayMs < remaining)) {
    return "exhausted";
  }
  return await new Promise((resolve) => {
    const timer = setTimeout(() => finish("continue"), delayMs);
    const onAbort = (): void => {
      finish("aborted");
    };
    let settled = false;
    function finish(result: GitIndexLockRetryWait): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      options.budget?.signal.removeEventListener("abort", onAbort);
      resolve(result);
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
    options.budget?.signal.addEventListener("abort", onAbort, { once: true });
  });
}
