import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "@main/services/git-exec.ts";
import { defaultWorktreeSignature } from "@main/services/git-watch-signatures.ts";
import { afterEach, describe, expect, it } from "vitest";

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
});
