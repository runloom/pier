import { EventEmitter } from "node:events";
import {
  createExecGitRaw,
  GIT_EXEC_DEFAULT_MAX_NUL_RECORDS,
  GIT_EXEC_DIAGNOSTIC_TAIL_BYTES,
  GIT_EXEC_HARD_MAX_NUL_RECORDS,
  GIT_EXEC_MAX_NUL_RECORD_BYTES,
  GIT_EXEC_MAX_OUTPUT_BYTES,
  GIT_EXEC_MAX_STDIN_BYTES,
  GIT_EXEC_MAX_TIMEOUT_MS,
  GitExecRawError,
} from "@main/services/git-exec.ts";
import { GitReviewBudget } from "@main/services/git-review/git-review-budget.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

class FakeReadable extends EventEmitter {
  destroyed = false;

  destroy(): void {
    this.destroyed = true;
  }
}

class FakeWritable extends EventEmitter {
  destroyed = false;
  ended = false;
  readonly writes: Buffer[] = [];
  writeResult = true;
  writeError: Error | undefined;

  destroy(): void {
    this.destroyed = true;
  }

  end(): void {
    this.ended = true;
  }

  write(chunk: Buffer): boolean {
    if (this.writeError !== undefined) {
      throw this.writeError;
    }
    this.writes.push(Buffer.from(chunk));
    return this.writeResult;
  }
}

class FakeChild extends EventEmitter {
  readonly killed: NodeJS.Signals[] = [];
  readonly stderr = new FakeReadable();
  readonly stdin = new FakeWritable();
  readonly stdout = new FakeReadable();

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killed.push(signal);
    return true;
  }
}

class SyncCloseOnKillChild extends FakeChild {
  override kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    super.kill(signal);
    this.emit("close", null);
    return true;
  }
}

function createRawFor(...children: FakeChild[]) {
  const spawn = vi.fn(() => {
    const child = children.shift();
    if (child === undefined) {
      throw new Error("missing fake child");
    }
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
  return { exec: createExecGitRaw({ spawn }), spawn };
}

async function rawError(promise: Promise<unknown>): Promise<GitExecRawError> {
  const error = await promise.catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(GitExecRawError);
  return error as GitExecRawError;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createExecGitRaw", () => {
  it("collect 模式只在成功时合并 stdout", async () => {
    const child = new FakeChild();
    const { exec } = createRawFor(child);
    const pending = exec(["status"], { cwd: "/repo", mode: "collect" });

    child.stdout.emit("data", Buffer.from("ab"));
    child.stdout.emit("data", Buffer.from("cd"));
    child.stderr.emit("data", Buffer.from("notice"));
    child.emit("close", 0);

    await expect(pending).resolves.toMatchObject({
      kind: "collected",
      stderrBytes: 6,
      stdout: Buffer.from("abcd"),
      stdoutBytes: 4,
    });
  });

  it("stream 模式跨 chunk 解析 NUL record 且不累计 stdout 正文", async () => {
    const child = new FakeChild();
    const { exec } = createRawFor(child);
    const records: Buffer[] = [];
    const pending = exec(["status", "-z"], {
      cwd: "/repo",
      mode: "stream",
      onRecord(record) {
        records.push(record);
        return "continue";
      },
    });

    child.stdout.emit("data", Buffer.from("fir"));
    child.stdout.emit("data", Buffer.from("st\0second\0"));
    child.emit("close", 0);

    expect(records).toEqual([Buffer.from("first"), Buffer.from("second")]);
    await expect(pending).resolves.toMatchObject({
      completeRecords: 2,
      kind: "streamed",
      stdoutBytes: 13,
    });
  });

  it("拒绝 EOF 半条 record", async () => {
    const child = new FakeChild();
    const { exec } = createRawFor(child);
    const pending = exec(["status", "-z"], {
      cwd: "/repo",
      mode: "stream",
      onRecord: () => "continue",
    });

    child.stdout.emit("data", Buffer.from("incomplete"));
    child.emit("close", 0);

    expect((await rawError(pending)).causeKind).toBe("incomplete-record");
  });

  it("允许 1 MiB record 精确边界并拒绝边界加一", async () => {
    const exactChild = new FakeChild();
    const largeChild = new FakeChild();
    const { exec } = createRawFor(exactChild, largeChild);
    const records: number[] = [];
    const exact = exec(["status", "-z"], {
      cwd: "/repo",
      mode: "stream",
      onRecord(record) {
        records.push(record.length);
        return "continue";
      },
    });
    exactChild.stdout.emit(
      "data",
      Buffer.concat([
        Buffer.alloc(GIT_EXEC_MAX_NUL_RECORD_BYTES, 97),
        Buffer.of(0),
      ])
    );
    exactChild.emit("close", 0);

    const tooLargeError = rawError(
      exec(["status", "-z"], {
        cwd: "/repo",
        mode: "stream",
        onRecord: () => "continue",
      })
    );
    largeChild.stdout.emit(
      "data",
      Buffer.alloc(GIT_EXEC_MAX_NUL_RECORD_BYTES + 1, 97)
    );
    largeChild.emit("close", null);

    await expect(exact).resolves.toMatchObject({ kind: "streamed" });
    expect(records).toEqual([GIT_EXEC_MAX_NUL_RECORD_BYTES]);
    expect((await tooLargeError).causeKind).toBe("record-limit");
  });

  it("达到 record 上限后返回完整 records + truncated，不受 kill exit code 改写", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const { exec } = createRawFor(child);
    const records: string[] = [];
    const pending = exec(["status", "-z"], {
      cwd: "/repo",
      maxRecords: 2,
      mode: "stream",
      onRecord(record) {
        records.push(record.toString("utf8"));
        return "continue";
      },
      timeoutMs: 10,
    });

    child.stdout.emit("data", Buffer.from("a\0b\0ignored\0"));
    child.emit("error", new Error("kill race"));
    child.stdout.emit("data", Buffer.from("late\0"));
    await vi.advanceTimersByTimeAsync(20);
    child.emit("close", 143);

    expect(child.killed).toEqual(["SIGTERM"]);
    expect(records).toEqual(["a", "b"]);
    await expect(pending).resolves.toMatchObject({
      completeRecords: 2,
      kind: "truncated",
    });
  });

  it("stdout/stderr 错误只保留各 64 KiB 尾部并记录总字节", async () => {
    const child = new FakeChild();
    const { exec } = createRawFor(child);
    const stdout = Buffer.concat([
      Buffer.alloc(GIT_EXEC_DIAGNOSTIC_TAIL_BYTES, 97),
      Buffer.from("stdout-end"),
    ]);
    const stderr = Buffer.concat([
      Buffer.alloc(GIT_EXEC_DIAGNOSTIC_TAIL_BYTES, 98),
      Buffer.from("stderr-end"),
    ]);
    const pending = exec(["status"], { cwd: "/repo", mode: "collect" });

    child.stdout.emit("data", stdout);
    child.stderr.emit("data", stderr);
    child.emit("close", 1);

    const error = await rawError(pending);
    expect(error.stdoutBytes).toBe(stdout.length);
    expect(error.stderrBytes).toBe(stderr.length);
    expect(error.stdoutTail).toHaveLength(GIT_EXEC_DIAGNOSTIC_TAIL_BYTES);
    expect(error.stderrTail).toHaveLength(GIT_EXEC_DIAGNOSTIC_TAIL_BYTES);
    expect(error.stdoutTail.subarray(-10).toString()).toBe("stdout-end");
    expect(error.stderrTail.subarray(-10).toString()).toBe("stderr-end");
  });

  it("总输出按 stdout + stderr 原始字节同步限流", async () => {
    const child = new FakeChild();
    const { exec } = createRawFor(child);
    const pending = exec(["status"], {
      cwd: "/repo",
      maxOutputBytes: 3,
      mode: "collect",
    });

    child.stdout.emit("data", Buffer.from("ab"));
    child.stderr.emit("data", Buffer.from("cd"));
    child.emit("close", null);

    const error = await rawError(pending);
    expect(error.causeKind).toBe("output-limit");
    expect(error.stdoutBytes + error.stderrBytes).toBe(4);
  });

  it("未传聚合预算时保留 16 MiB 单命令默认上限", async () => {
    const child = new FakeChild();
    const { exec } = createRawFor(child);
    const pending = exec(["status"], { cwd: "/repo", mode: "collect" });
    const chunk = Buffer.alloc(1024 * 1024, 120);
    for (let index = 0; index < 16; index += 1) {
      child.stderr.emit("data", chunk);
    }
    child.stderr.emit("data", Buffer.of(120));
    child.emit("close", null);

    const error = await rawError(pending);
    expect(error.causeKind).toBe("output-limit");
    expect(error.stderrBytes).toBe(16 * 1024 * 1024 + 1);
  });

  it("同一 GitReviewBudget 跨子命令累计输出", async () => {
    const firstChild = new FakeChild();
    const secondChild = new FakeChild();
    const { exec } = createRawFor(firstChild, secondChild);
    const budget = new GitReviewBudget({ maxOutputBytes: 5 });
    const first = exec(["one"], { budget, cwd: "/repo", mode: "collect" });
    firstChild.stdout.emit("data", Buffer.from("abc"));
    firstChild.emit("close", 0);
    await first;

    const second = exec(["two"], {
      budget,
      cwd: "/repo",
      mode: "collect",
    });
    secondChild.stdout.emit("data", Buffer.from("def"));
    secondChild.emit("close", null);

    expect((await rawError(second)).causeKind).toBe("output-limit");
    expect(budget.snapshot().outputBytes).toBe(6);
  });

  it("启动前取消不 spawn，运行中取消关闭 stdin 并只结算一次", async () => {
    const before = new AbortController();
    before.abort();
    const beforeSpawn = vi.fn();
    const execBefore = createExecGitRaw({
      spawn:
        beforeSpawn as unknown as typeof import("node:child_process").spawn,
    });
    const beforeError = await rawError(
      execBefore(["status"], {
        cwd: "/repo",
        mode: "collect",
        signal: before.signal,
      })
    );
    expect(beforeError.causeKind).toBe("aborted");
    expect(beforeSpawn).not.toHaveBeenCalled();

    const child = new FakeChild();
    const controller = new AbortController();
    const { exec } = createRawFor(child);
    const pending = exec(["status"], {
      cwd: "/repo",
      mode: "collect",
      signal: controller.signal,
    });
    controller.abort();
    controller.abort();
    child.emit("close", null);

    expect(child.stdin.destroyed).toBe(true);
    expect(child.killed).toEqual(["SIGTERM"]);
    expect((await rawError(pending)).causeKind).toBe("aborted");
  });

  it("kill 同步触发 close 后不遗留 watchdog", async () => {
    vi.useFakeTimers();
    const child = new SyncCloseOnKillChild();
    const controller = new AbortController();
    const { exec } = createRawFor(child);
    const pending = exec(["status"], {
      cwd: "/repo",
      mode: "collect",
      signal: controller.signal,
    });

    controller.abort();

    expect((await rawError(pending)).causeKind).toBe("aborted");
    expect(child.killed).toEqual(["SIGTERM"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("spawn 同步期间发生 abort 不会丢失", async () => {
    const child = new FakeChild();
    const controller = new AbortController();
    const spawn = vi.fn(() => {
      controller.abort();
      return child;
    }) as unknown as typeof import("node:child_process").spawn;
    const exec = createExecGitRaw({ spawn });
    const pending = exec(["status"], {
      cwd: "/repo",
      mode: "collect",
      signal: controller.signal,
    });

    expect(child.killed).toEqual(["SIGTERM"]);
    expect(child.stdin.writes).toHaveLength(0);
    child.emit("close", null);
    expect((await rawError(pending)).causeKind).toBe("aborted");
  });

  it("同步 spawn 耗时计入绝对 deadline", async () => {
    let now = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const child = new FakeChild();
    const spawn = vi.fn(() => {
      now = 100;
      return child;
    }) as unknown as typeof import("node:child_process").spawn;
    const exec = createExecGitRaw({ spawn });
    const pending = exec(["status"], {
      cwd: "/repo",
      deadlineAtMs: 100,
      mode: "collect",
      timeoutMs: 1000,
    });

    expect(child.killed).toEqual(["SIGTERM"]);
    child.emit("close", null);
    expect((await rawError(pending)).causeKind).toBe("timeout");
    nowSpy.mockRestore();
  });

  it("child 永不 close 时在 SIGKILL 后有界结算", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const { exec } = createRawFor(child);
    const error = rawError(
      exec(["status"], { cwd: "/repo", mode: "collect", timeoutMs: 10 })
    );

    await vi.advanceTimersByTimeAsync(10 + 1500 + 250);

    expect(child.killed).toEqual(["SIGTERM", "SIGKILL"]);
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect((await error).causeKind).toBe("timeout");
  });

  it("主动截断后 child 永不 close 仍有界返回 truncated", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const { exec } = createRawFor(child);
    const pending = exec(["status", "-z"], {
      cwd: "/repo",
      maxRecords: 1,
      mode: "stream",
      onRecord: () => "continue",
    });
    child.stdout.emit("data", Buffer.from("record\0"));

    await vi.advanceTimersByTimeAsync(1500 + 250);

    await expect(pending).resolves.toMatchObject({
      completeRecords: 1,
      kind: "truncated",
    });
  });

  it("stdin 支持 8 MiB 边界、backpressure drain 与 EPIPE", async () => {
    const backpressureChild = new FakeChild();
    backpressureChild.stdin.writeResult = false;
    const epipeChild = new FakeChild();
    epipeChild.stdin.writeError = new Error("EPIPE");
    const { exec } = createRawFor(backpressureChild, epipeChild);
    const input = Buffer.alloc(GIT_EXEC_MAX_STDIN_BYTES);
    const backpressure = exec(["apply"], {
      cwd: "/repo",
      mode: "collect",
      stdin: input,
    });
    expect(backpressureChild.stdin.ended).toBe(false);
    backpressureChild.stdin.emit("drain");
    expect(backpressureChild.stdin.ended).toBe(true);
    backpressureChild.emit("close", 0);
    await backpressure;

    const epipe = exec(["apply"], {
      cwd: "/repo",
      mode: "collect",
      stdin: Buffer.from("patch"),
    });
    epipeChild.emit("close", null);

    expect((await rawError(epipe)).causeKind).toBe("stdin-error");
  });

  it("stdin 超过 8 MiB 在 spawn 前失败", async () => {
    const spawn = vi.fn();
    const exec = createExecGitRaw({
      spawn: spawn as unknown as typeof import("node:child_process").spawn,
    });

    const error = await rawError(
      exec(["apply"], {
        cwd: "/repo",
        mode: "collect",
        stdin: Buffer.alloc(GIT_EXEC_MAX_STDIN_BYTES + 1),
      })
    );

    expect(error.causeKind).toBe("stdin-limit");
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    ["maxOutputBytes", Number.NaN],
    ["maxOutputBytes", Number.POSITIVE_INFINITY],
    ["maxOutputBytes", 0],
    ["timeoutMs", -1],
    ["timeoutMs", GIT_EXEC_MAX_TIMEOUT_MS + 1],
    ["timeoutMs", Number.MAX_SAFE_INTEGER],
    ["deadlineAtMs", Number.POSITIVE_INFINITY],
    ["deadlineAtMs", Number.MAX_SAFE_INTEGER],
  ] as const)("非法 %s=%s 在 spawn 前稳定失败", async (name, value) => {
    const spawn = vi.fn();
    const exec = createExecGitRaw({
      spawn: spawn as unknown as typeof import("node:child_process").spawn,
    });
    const error = await rawError(
      exec(["status"], {
        cwd: "/repo",
        mode: "collect",
        [name]: value,
      })
    );

    expect(error.causeKind).toBe("configuration");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("非法 stream record 边界在 spawn 前稳定失败", async () => {
    const spawn = vi.fn();
    const exec = createExecGitRaw({
      spawn: spawn as unknown as typeof import("node:child_process").spawn,
    });
    const error = await rawError(
      exec(["status"], {
        cwd: "/repo",
        maxRecordBytes: Number.NaN,
        maxRecords: Number.POSITIVE_INFINITY,
        mode: "stream",
        onRecord: () => "continue",
      })
    );

    expect(error.causeKind).toBe("configuration");
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    ["maxOutputBytes", GIT_EXEC_MAX_OUTPUT_BYTES + 1],
    ["maxRecordBytes", GIT_EXEC_MAX_NUL_RECORD_BYTES + 1],
    ["maxRecords", GIT_EXEC_HARD_MAX_NUL_RECORDS + 1],
    ["maxRecordBytes", Number.MAX_SAFE_INTEGER],
  ] as const)("%s 超过硬上限时绝不 spawn", async (name, value) => {
    const spawn = vi.fn();
    const exec = createExecGitRaw({
      spawn: spawn as unknown as typeof import("node:child_process").spawn,
    });
    const base = {
      cwd: "/repo",
      mode: "stream" as const,
      onRecord: () => "continue" as const,
    };
    const options =
      name === "maxOutputBytes"
        ? { ...base, maxOutputBytes: value }
        : { ...base, [name]: value };

    expect((await rawError(exec(["status"], options))).causeKind).toBe(
      "configuration"
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it("保持 2000 条默认门，并允许 review 在硬门内显式提升", async () => {
    expect(GIT_EXEC_DEFAULT_MAX_NUL_RECORDS).toBe(2000);
    expect(GIT_EXEC_HARD_MAX_NUL_RECORDS).toBeGreaterThanOrEqual(8002);

    const child = new FakeChild();
    const { exec, spawn } = createRawFor(child);
    const promise = exec(["status"], {
      cwd: "/repo",
      maxRecords: 8002,
      mode: "stream",
      onRecord: () => "continue",
    });
    child.stdout.emit("end");
    child.stderr.emit("end");
    child.emit("close", 0, null);

    await expect(promise).resolves.toMatchObject({ kind: "streamed" });
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("signal 与 budget 共享时保留 typed budget failure", async () => {
    const child = new FakeChild();
    const { exec } = createRawFor(child);
    const controller = new AbortController();
    const budget = {
      consumeOutputBytes: () => "ok" as const,
      failureReason: () => "output-limit" as const,
      remainingTimeMs: () => 1000,
      signal: controller.signal,
    };
    const pending = exec(["status"], {
      budget,
      cwd: "/repo",
      mode: "collect",
      signal: controller.signal,
    });

    controller.abort("output-limit");
    child.emit("close", null);

    expect((await rawError(pending)).causeKind).toBe("output-limit");
  });

  it("调用者不能覆盖 Git 非交互安全环境", async () => {
    const child = new FakeChild();
    const { exec, spawn } = createRawFor(child);
    const pending = exec(["status"], {
      cwd: "/repo",
      env: { GIT_PAGER: "less", GIT_TERMINAL_PROMPT: "1" },
      mode: "collect",
    });
    child.emit("close", 0);
    await pending;

    expect(spawn).toHaveBeenCalledWith(
      "git",
      ["status"],
      expect.objectContaining({
        env: expect.objectContaining({
          GIT_PAGER: "cat",
          GIT_TERMINAL_PROMPT: "0",
        }),
      })
    );
  });

  it("外部信号退出保留 signal 诊断", async () => {
    const child = new FakeChild();
    const { exec } = createRawFor(child);
    const pending = exec(["status"], { cwd: "/repo", mode: "collect" });

    child.emit("close", null, "SIGKILL");

    const error = await rawError(pending);
    expect(error.causeKind).toBe("exit");
    expect(error.signal).toBe("SIGKILL");
    expect(error.message).toContain("SIGKILL");
  });

  it("hook signal 在 UTF-8 路径跨 chunk 时仍能识别", async () => {
    const child = new FakeChild();
    const { exec } = createRawFor(child);
    const pending = exec(["commit"], { cwd: "/repo", mode: "collect" });
    const stderr = Buffer.from("error: /仓库/.husky/post died of signal 9\n");
    const split = stderr.indexOf(Buffer.from("库")) + 1;

    child.stderr.emit("data", stderr.subarray(0, split));
    child.stderr.emit("data", stderr.subarray(split));
    child.emit("close", 1);

    expect((await rawError(pending)).hookSignal).toEqual({
      hookPath: "/仓库/.husky/post",
      signal: 9,
    });
  });
});
