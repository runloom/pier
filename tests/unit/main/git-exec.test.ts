import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createExecGit,
  execGit,
  GitExecError,
} from "@main/services/git-exec.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Minimal ChildProcess 替身:够 git-exec 状态机消费的子集
 * (stdout/stderr 是 Readable-like EventEmitter,kill 记录信号序列)
 */
class FakeStream extends EventEmitter {}
class FakeChild extends EventEmitter {
  stdout = new FakeStream();
  stderr = new FakeStream();
  killed: string[] = [];
  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killed.push(signal);
    return true;
  }
}

const GIT_VERSION_RE = /^git version /;
const NOT_A_GIT_REPO_RE = /not a git repository/i;
const SIZE_LIMIT_RE = /上限|size/i;
const EPIPE_STDOUT_RE = /EPIPE from stdout/;

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("execGit", () => {
  it("成功执行 git --version 返回 stdout", async () => {
    const dir = await makeTempDir("pier-git-exec-version-");

    const stdout = await execGit(["--version"], { cwd: dir });

    expect(stdout).toMatch(GIT_VERSION_RE);
  });

  it("在非 git 目录跑 git status 抛 GitExecError 含 stderr 与非零 exitCode", async () => {
    const dir = await makeTempDir("pier-git-exec-non-repo-");

    const error = await execGit(["status"], { cwd: dir }).catch(
      (err: unknown) => err
    );

    expect(error).toBeInstanceOf(GitExecError);
    if (error instanceof GitExecError) {
      expect(error.exitCode).not.toBe(0);
      expect(error.stderr).toMatch(NOT_A_GIT_REPO_RE);
    }
  });

  it("cwd 生效：在已 init 的临时仓库里 git rev-parse --is-inside-work-tree 返回 true", async () => {
    const repo = await makeTempDir("pier-git-exec-repo-");
    await execGit(["init", "-b", "main"], { cwd: repo });

    const stdout = await execGit(["rev-parse", "--is-inside-work-tree"], {
      cwd: repo,
    });

    expect(stdout.trim()).toBe("true");
  });

  // SIGKILL fallback:SIGTERM 后 SIGKILL_GRACE_MS 未关闭强制升级 SIGKILL
  it("SIGTERM 后 1.5s 未关闭则升级 SIGKILL", async () => {
    vi.useFakeTimers();
    const fakeChild = new FakeChild();
    const fakeSpawn = (() =>
      fakeChild) as unknown as typeof import("node:child_process").spawn;
    const exec = createExecGit({ spawn: fakeSpawn });

    const pending = exec(["status"], {
      cwd: "/tmp/fake",
      timeoutMs: 100,
    }).catch(() => {
      // 我们只关心 kill 顺序,catch 防 unhandled rejection
    });

    // 推进到 timeout 触发 SIGTERM
    await vi.advanceTimersByTimeAsync(100);
    expect(fakeChild.killed).toEqual(["SIGTERM"]);

    // 再推进 1.5s 触发 SIGKILL fallback
    await vi.advanceTimersByTimeAsync(1500);
    expect(fakeChild.killed).toEqual(["SIGTERM", "SIGKILL"]);

    // 让 child 真正 close 以便 promise 收尾
    fakeChild.emit("close", null);
    await pending;
    vi.useRealTimers();
  });

  // stream error 累加:GitExecError.message 应携带 stream error 诊断信息(不再 noop 吞)
  it("stdout/stderr 的 error 事件被累加到 GitExecError.message", async () => {
    const fakeChild = new FakeChild();
    const fakeSpawn = (() =>
      fakeChild) as unknown as typeof import("node:child_process").spawn;
    const exec = createExecGit({ spawn: fakeSpawn });

    const pending = exec(["status"], { cwd: "/tmp/fake" });

    queueMicrotask(() => {
      fakeChild.stdout.emit("error", new Error("EPIPE from stdout"));
      fakeChild.emit("close", 1);
    });

    const error = await pending.catch((err: unknown) => err);
    expect(error).toBeInstanceOf(GitExecError);
    if (error instanceof GitExecError) {
      expect(error.message).toMatch(EPIPE_STDOUT_RE);
    }
  });

  // C4 验证：maxOutputBytes 可注入；按字节累加（非 string.length）触发 size-limit
  it("超过 maxOutputBytes 抛 size-limit GitExecError", async () => {
    const dir = await makeTempDir("pier-git-exec-size-");

    const error = await execGit(["--version"], {
      cwd: dir,
      maxOutputBytes: 1,
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(GitExecError);
    if (error instanceof GitExecError) {
      expect(error.message).toMatch(SIZE_LIMIT_RE);
    }
  });
});
