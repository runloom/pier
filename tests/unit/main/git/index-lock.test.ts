import {
  type ExecGitRaw,
  GitExecError,
  GitExecRawError,
  type GitExecRawResult,
} from "@main/services/git/exec.ts";
import {
  GIT_INDEX_LOCK_RETRY_ATTEMPTS,
  gitOutputHasIndexLock,
  isGitIndexLockContention,
  withGitIndexLockRetry,
} from "@main/services/git/index-lock.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const empty = Buffer.alloc(0);

function collected(stdout = "ok"): GitExecRawResult {
  return {
    kind: "collected",
    stderrBytes: 0,
    stderrTail: empty,
    stdout: Buffer.from(stdout),
    stdoutBytes: stdout.length,
  };
}

function rawExit(message: string, causeKind: "exit" | "timeout" = "exit") {
  return new GitExecRawError({
    args: ["add", "--", "a.ts"],
    causeKind,
    cwd: "/repo",
    exitCode: causeKind === "exit" ? 128 : null,
    message,
    stderrBytes: Buffer.byteLength(message),
    stderrTail: Buffer.from(message),
    stdoutBytes: 0,
    stdoutTail: empty,
  });
}

function budgetRemaining(ms: number) {
  return {
    consumeOutputBytes: () => "ok" as const,
    failureReason: () => null,
    remainingTimeMs: () => ms,
    signal: new AbortController().signal,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("gitOutputHasIndexLock", () => {
  it("识别主仓与 worktree 的 index.lock 路径", () => {
    expect(
      gitOutputHasIndexLock("fatal: Unable to create '/r/.git/index.lock'")
    ).toBe(true);
    expect(
      gitOutputHasIndexLock(
        "fatal: Unable to create '/r/.git/worktrees/feat-canvas/index.lock': File exists."
      )
    ).toBe(true);
    expect(
      gitOutputHasIndexLock("fatal: pathspec 'gone.ts' did not match")
    ).toBe(false);
  });

  it("不把路径碰巧含 index.lock 的非锁错误当成争用", () => {
    expect(
      gitOutputHasIndexLock(
        "fatal: pathspec 'index.lock' did not match any files"
      )
    ).toBe(false);
    expect(
      gitOutputHasIndexLock(
        "fatal: Unable to create '/r/.git/HEAD.lock': File exists."
      )
    ).toBe(false);
  });
});

describe("isGitIndexLockContention", () => {
  it("只把 exit + index.lock 当成争用", () => {
    expect(
      isGitIndexLockContention(
        rawExit("git 退出码 128: fatal: Unable to create '/r/.git/index.lock'")
      )
    ).toBe(true);
    expect(
      isGitIndexLockContention(rawExit("git 退出码 128: not a git repository"))
    ).toBe(false);
    expect(
      isGitIndexLockContention(
        rawExit("fatal: pathspec 'index.lock' did not match any files")
      )
    ).toBe(false);
    expect(
      isGitIndexLockContention(
        rawExit("fatal: Unable to create '/r/.git/index.lock'", "timeout")
      )
    ).toBe(false);
  });

  it("识别文本 GitExecError", () => {
    const error = new GitExecError({
      args: ["add"],
      causeKind: "exit",
      cwd: "/repo",
      exitCode: 128,
      message:
        "git 退出码 128: fatal: Unable to create '/r/.git/worktrees/feat/index.lock'",
      stderr:
        "fatal: Unable to create '/r/.git/worktrees/feat/index.lock': File exists.",
      stdout: "",
    });
    expect(isGitIndexLockContention(error)).toBe(true);
  });
});

describe("withGitIndexLockRetry", () => {
  it("锁争用重试后成功，退避 20ms 起跳倍增", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const run: ExecGitRaw = async () => {
      calls += 1;
      if (calls < 3) {
        throw rawExit(
          "fatal: Unable to create '/repo/.git/worktrees/feat-canvas/index.lock'"
        );
      }
      return collected();
    };
    const pending = withGitIndexLockRetry(run)(["add"], {
      cwd: "/repo",
      mode: "collect",
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(40);
    await expect(pending).resolves.toMatchObject({ kind: "collected" });
    expect(calls).toBe(3);
  });

  it("非锁 128 不重试", async () => {
    const run = vi.fn(async () => {
      throw rawExit("fatal: pathspec 'gone.ts' did not match any files");
    }) satisfies ExecGitRaw;
    await expect(
      withGitIndexLockRetry(run)(["add"], { cwd: "/repo", mode: "collect" })
    ).rejects.toBeInstanceOf(GitExecRawError);
    expect(run).toHaveBeenCalledOnce();
  });

  it("abort 中途停止重试并抛 aborted", async () => {
    const controller = new AbortController();
    let calls = 0;
    const run: ExecGitRaw = async () => {
      calls += 1;
      throw rawExit("fatal: Unable to create '/repo/.git/index.lock'");
    };
    const pending = withGitIndexLockRetry(run)(["add"], {
      cwd: "/repo",
      mode: "collect",
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      causeKind: "aborted",
      name: "GitExecRawError",
    });
    expect(calls).toBe(1);
  });

  it("退避等待期间 abort 抛 aborted 而不是锁错误", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const run = vi.fn(async () => {
      throw rawExit("fatal: Unable to create '/repo/.git/index.lock'");
    }) satisfies ExecGitRaw;
    const pending = withGitIndexLockRetry(run)(["add"], {
      cwd: "/repo",
      mode: "collect",
      signal: controller.signal,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      causeKind: "aborted",
      name: "GitExecRawError",
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it("退避等待期间预算终止抛 timeout 而不是锁错误", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const run = vi.fn(async () => {
      throw rawExit("fatal: Unable to create '/repo/.git/index.lock'");
    }) satisfies ExecGitRaw;
    const pending = withGitIndexLockRetry(run)(["add"], {
      budget: {
        consumeOutputBytes: () => "ok" as const,
        failureReason: () =>
          controller.signal.aborted ? ("timeout" as const) : null,
        remainingTimeMs: () => 10_000,
        signal: controller.signal,
      },
      cwd: "/repo",
      mode: "collect",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      causeKind: "timeout",
      name: "GitExecRawError",
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it("剩余预算不够下一跳时停止", async () => {
    const run = vi.fn(async () => {
      throw rawExit("fatal: Unable to create '/repo/.git/index.lock'");
    }) satisfies ExecGitRaw;
    await expect(
      withGitIndexLockRetry(run)(["add"], {
        budget: budgetRemaining(10),
        cwd: "/repo",
        mode: "collect",
      })
    ).rejects.toMatchObject({
      causeKind: "exit",
      name: "GitExecRawError",
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it("耗尽次数后把最后一次锁错误抛出", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => {
      throw rawExit("fatal: Unable to create '/repo/.git/index.lock'");
    }) satisfies ExecGitRaw;
    const pending = withGitIndexLockRetry(run)(["add"], {
      cwd: "/repo",
      mode: "collect",
    });
    const advancing = pending.catch((error: unknown) => error);
    for (let delay = 20, i = 0; i < GIT_INDEX_LOCK_RETRY_ATTEMPTS - 1; i += 1) {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(delay);
      delay *= 2;
    }
    expect(await advancing).toBeInstanceOf(GitExecRawError);
    expect(run).toHaveBeenCalledTimes(GIT_INDEX_LOCK_RETRY_ATTEMPTS);
  });
});
