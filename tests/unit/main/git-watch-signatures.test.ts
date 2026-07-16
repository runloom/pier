import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "@main/services/git-exec.ts";
import { watchRealpath } from "@main/services/git-watch-file-system.ts";
import {
  changedFilesStatSignal,
  defaultWorktreeSignature,
  defaultWorktreeSnapshot,
  resolveRepoAnchors,
} from "@main/services/git-watch-signatures.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

let gitRoot: string;

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-sig-stat-"));
  await execGit(["init", "-q", "-b", "main"], { cwd: dir });
  await execGit(["config", "user.email", "test@pier.local"], { cwd: dir });
  await execGit(["config", "user.name", "Pier Test"], { cwd: dir });
  return dir;
}

describe("defaultWorktreeSignature — 变更文件 stat 信号", () => {
  afterEach(async () => {
    if (gitRoot) {
      await rm(gitRoot, { recursive: true, force: true });
    }
  });

  it("同文件再次改写、numstat 行数不变但 size 不同时签名必须不同（核心回归）", async () => {
    gitRoot = await initRepo();
    const file = join(gitRoot, "a.txt");

    // 初次 commit：建基线
    await writeFile(file, "line-a\n");
    await execGit(["add", "a.txt"], { cwd: gitRoot });
    await execGit(["commit", "-q", "-m", "init"], { cwd: gitRoot });

    // 第一次修改：1 插 1 删（6 字节 → 8 字节 "line-b!\n"）
    await writeFile(file, "line-b!\n");
    const sig1 = await defaultWorktreeSignature(gitRoot);

    // 第二次修改：仍 1 插 1 删，但内容/长度不同（8 → 10 字节 "line-c!!\n"）
    await writeFile(file, "line-c!!\n");
    const sig2 = await defaultWorktreeSignature(gitRoot);

    expect(sig1).not.toBe(sig2);
  });

  it("干净工作树修改文件后签名变化（基本灵敏度）", async () => {
    gitRoot = await initRepo();
    const file = join(gitRoot, "b.txt");

    await writeFile(file, "clean\n");
    await execGit(["add", "b.txt"], { cwd: gitRoot });
    await execGit(["commit", "-q", "-m", "init"], { cwd: gitRoot });

    const sigClean = await defaultWorktreeSignature(gitRoot);

    await writeFile(file, "dirty\n");
    const sigDirty = await defaultWorktreeSignature(gitRoot);

    expect(sigClean).not.toBe(sigDirty);
  });

  it("同一状态连续计算两次签名相等（无抖动）", async () => {
    gitRoot = await initRepo();
    const file = join(gitRoot, "c.txt");

    await writeFile(file, "stable\n");
    await execGit(["add", "c.txt"], { cwd: gitRoot });
    await execGit(["commit", "-q", "-m", "init"], { cwd: gitRoot });

    // 制造一个脏状态
    await writeFile(file, "modified\n");

    const sig1 = await defaultWorktreeSignature(gitRoot);
    const sig2 = await defaultWorktreeSignature(gitRoot);

    expect(sig1).toBe(sig2);
  });

  it("status 或任一 numstat 不可用时快照明确标记为不可靠", async () => {
    const statusFailure = await defaultWorktreeSnapshot("/repo", async () => {
      throw new Error("status unavailable");
    });
    expect(statusFailure).toEqual({ reliable: false, signature: "" });

    for (const failedCommand of ["unstaged", "staged"] as const) {
      const snapshot = await defaultWorktreeSnapshot("/repo", async (args) => {
        if (args[0] === "status") {
          return "";
        }
        const staged = args.includes("--cached");
        if (
          (failedCommand === "staged" && staged) ||
          (failedCommand === "unstaged" && !staged)
        ) {
          throw new Error(`${failedCommand} numstat unavailable`);
        }
        return "";
      });
      expect(snapshot.reliable).toBe(false);
      expect(snapshot.raw).toBeUndefined();
      expect(snapshot.signature).not.toBe("");
    }
  });

  it("大量变更文件只使用有界 stat 并发", async () => {
    const statusOut = `${Array.from(
      { length: 64 },
      (_, index) => `1 .M N... 100644 100644 100644 a b file-${index}.ts`
    ).join("\0")}\0`;
    let active = 0;
    let maxActive = 0;

    const signal = await changedFilesStatSignal("/repo", statusOut, {
      stat: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return { mtimeMs: 1, size: 2 };
      },
    });

    expect(maxActive).toBe(16);
    expect(signal.split("\u0002")).toHaveLength(64);
  });

  it("超过 5,000 个变更时仍把尾部文件内容变化计入签名", async () => {
    const statusOut = `${Array.from(
      { length: 5001 },
      (_, index) => `1 .M N... 100644 100644 100644 a b file-${index}.ts`
    ).join("\0")}\0`;
    let tailMtime = 1;
    const stat = vi.fn(async (path: string) => ({
      mtimeMs: path.endsWith("file-5000.ts") ? tailMtime : 1,
      size: 2,
    }));

    const first = await changedFilesStatSignal("/repo", statusOut, { stat });
    tailMtime = 2;
    const second = await changedFilesStatSignal("/repo", statusOut, { stat });

    expect(stat).toHaveBeenCalledTimes(10_002);
    expect(first).not.toBe(second);
  });

  it("stat 卡死时按截止时间返回固定哨兵且不再派发后续文件", async () => {
    const statusOut = `${Array.from(
      { length: 64 },
      (_, index) => `1 .M N... 100644 100644 100644 a b file-${index}.ts`
    ).join("\0")}\0`;
    let calls = 0;

    const signal = await changedFilesStatSignal("/repo", statusOut, {
      stat: () => {
        calls += 1;
        return new Promise(() => undefined);
      },
      timeoutMs: 5,
    });

    expect(signal).toBe("stat-signal-unavailable");
    expect(calls).toBe(16);
  });

  it("同一根迟到 stat 未结算时跨刷新不叠加，结算后恢复容量", async () => {
    const statusOut = `${Array.from(
      { length: 64 },
      (_, index) => `1 .M N... 100644 100644 100644 a b file-${index}.ts`
    ).join("\0")}\0`;
    let blocking = true;
    const release: Array<() => void> = [];
    const stat = vi.fn(
      () =>
        new Promise<{ mtimeMs: number; size: number }>((resolve) => {
          if (blocking) {
            release.push(() => resolve({ mtimeMs: 1, size: 2 }));
            return;
          }
          resolve({ mtimeMs: 3, size: 4 });
        })
    );

    for (let round = 0; round < 3; round += 1) {
      await expect(
        changedFilesStatSignal("/stalled-repo", statusOut, {
          stat,
          timeoutMs: 5,
        })
      ).resolves.toBe("stat-signal-unavailable");
    }
    expect(stat).toHaveBeenCalledTimes(16);

    blocking = false;
    for (const settle of release) {
      settle();
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const recovered = await changedFilesStatSignal("/stalled-repo", statusOut, {
      stat,
      timeoutMs: 50,
    });
    expect(recovered).not.toBe("stat-signal-unavailable");
    expect(stat).toHaveBeenCalledTimes(80);
  });

  it("不同仓库共享原始 stat 全局上限，迟到任务结算后恢复", async () => {
    const statusOut = `${Array.from(
      { length: 64 },
      (_, index) => `1 .M N... 100644 100644 100644 a b file-${index}.ts`
    ).join("\0")}\0`;
    let blocking = true;
    const release: Array<() => void> = [];
    const stat = vi.fn(
      () =>
        new Promise<{ mtimeMs: number; size: number }>((resolve) => {
          if (blocking) {
            release.push(() => resolve({ mtimeMs: 1, size: 2 }));
            return;
          }
          resolve({ mtimeMs: 3, size: 4 });
        })
    );

    const stalledSignals = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        changedFilesStatSignal(`/stalled-repo-${index}`, statusOut, {
          stat,
          timeoutMs: 5,
        })
      )
    );
    expect(new Set(stalledSignals)).toEqual(
      new Set(["stat-signal-unavailable"])
    );
    expect(stat.mock.calls.length).toBeGreaterThan(0);
    expect(stat.mock.calls.length).toBeLessThanOrEqual(32);
    const callsBeforeRecovery = stat.mock.calls.length;

    blocking = false;
    for (const settle of release) {
      settle();
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    await changedFilesStatSignal("/recovered-repo", statusOut, {
      stat,
      timeoutMs: 50,
    });
    expect(stat).toHaveBeenCalledTimes(callsBeforeRecovery + 64);
  });

  it("同路径并发 realpath 共享底层探测且各自完成", async () => {
    const [first, second] = await Promise.all([
      watchRealpath(process.cwd()),
      watchRealpath(process.cwd()),
    ]);

    expect(second).toBe(first);
  });

  it("仓库路径含尾空格、Tab、CR 和 LF 时保留精确锚点", async () => {
    const parent = await mkdtemp(join(tmpdir(), "pier-sig-path-"));
    gitRoot = parent;
    const repo = join(parent, "repo \t\r\n");
    await mkdir(repo);
    await execGit(["init", "-q", "-b", "main"], { cwd: repo });

    const anchors = await resolveRepoAnchors(repo);
    const expectedGitDir = await realpath(join(repo, ".git"));
    expect(anchors).toEqual({
      commonDir: expectedGitDir,
      gitDir: expectedGitDir,
    });
  });
});
