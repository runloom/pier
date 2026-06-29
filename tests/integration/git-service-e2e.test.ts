/**
 * 端到端集成测试:在真临时 git 仓库里跑 createGitService() 和
 * createGitWatchService() 的默认配置(真 spawn / 真 fs.watch),
 * 验证「单元测试只测 args 拼接」之外的运行时行为。
 *
 * 单测的盲区(被这层覆盖):
 * - 写操作的 git CLI flag 拼对了但语义错(`-d`/`-D`/`--cached` 等)
 * - 解析器对真实 git 输出格式的兼容(版本差异/平台差异)
 * - watch 真 fs event → debounce → listener 的端到端链路
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "@main/services/git-exec.ts";
import { createGitService } from "@main/services/git-service.ts";
import { createGitWatchService } from "@main/services/git-watch-service.ts";
import { afterEach, describe, expect, it } from "vitest";

const OID_RE = /^[0-9a-f]{40}$/;

const tempDirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-git-e2e-"));
  tempDirs.push(dir);
  await execGit(["init", "-b", "main"], { cwd: dir });
  await execGit(["config", "user.email", "test@pier.local"], { cwd: dir });
  await execGit(["config", "user.name", "Pier Test"], { cwd: dir });
  await execGit(["config", "commit.gpgsign", "false"], { cwd: dir });
  await writeFile(join(dir, "base.txt"), "hello\nworld\n");
  await execGit(["add", "base.txt"], { cwd: dir });
  await execGit(["commit", "-m", "initial"], { cwd: dir, timeoutMs: 30_000 });
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("GitService 端到端(真临时仓库)", () => {
  it("getRepoInfo 反映真 HEAD/gitRoot/isWorktree", async () => {
    const repo = await makeRepo();
    const git = createGitService();

    const info = await git.getRepoInfo(repo);

    expect(info.headOid).toMatch(OID_RE);
    expect(info.isBare).toBe(false);
    expect(info.isWorktree).toBe(false);
    expect(info.gitRoot).toContain(tempDirs.at(-1) ?? "");
  });

  it("getStatus 经历 modify→stage→unstage→discard 各阶段反映正确", async () => {
    const repo = await makeRepo();
    const git = createGitService();

    expect(await git.isWorkingTreeClean(repo)).toBe(true);

    // modify
    await writeFile(join(repo, "base.txt"), "modified content\n");
    const afterModify = await git.getStatus(repo);
    expect(afterModify.files.some((f) => f.path === "base.txt")).toBe(true);
    expect(afterModify.files[0]?.worktree).toBe("M");

    // stage
    await git.stage(repo, { paths: ["base.txt"] });
    const afterStage = await git.getStatus(repo);
    expect(afterStage.files[0]?.index).toBe("M");

    // unstage
    await git.unstage(repo, { paths: ["base.txt"] });
    const afterUnstage = await git.getStatus(repo);
    expect(afterUnstage.files[0]?.worktree).toBe("M");
    expect(afterUnstage.files[0]?.index).toBe(".");

    // discard
    await git.discardChanges(repo, { paths: ["base.txt"] });
    expect(await git.isWorkingTreeClean(repo)).toBe(true);
  });

  it("stage + commit 真的产生新 commit,getLog 看见", async () => {
    const repo = await makeRepo();
    const git = createGitService();

    await writeFile(join(repo, "feature.txt"), "new file\n");
    await git.stage(repo, { paths: ["feature.txt"] });
    await git.commit(repo, { message: "feat: add feature.txt" });

    const log = await git.getLog(repo, { maxCount: 5 });
    expect(log[0]?.message).toBe("feat: add feature.txt");
    expect(log[0]?.author).toBe("Pier Test");
    expect(log).toHaveLength(2);
  });

  it("getDiffSummary 反映真实增删行数;getDiffPatch 解析真实 hunk", async () => {
    const repo = await makeRepo();
    const git = createGitService();
    await writeFile(join(repo, "base.txt"), "hello\nworld\nadded\n");

    const summary = await git.getDiffSummary(repo);
    expect(summary.insertions).toBe(1);
    expect(summary.deletions).toBe(0);
    expect(summary.files[0]?.path).toBe("base.txt");

    const patch = await git.getDiffPatch(repo);
    expect(patch.files[0]?.path).toBe("base.txt");
    expect(patch.files[0]?.hunks.length).toBeGreaterThan(0);
    const addLines = patch.files[0]?.hunks[0]?.lines.filter(
      (l) => l.kind === "add"
    );
    expect(addLines?.[0]?.text).toBe("added");
  });

  it("createBranch + listBranches + checkoutBranch + deleteBranch 全流程", async () => {
    const repo = await makeRepo();
    const git = createGitService();

    await git.createBranch(repo, { name: "feature/x" });
    const branchesAfterCreate = await git.listBranches(repo, { kind: "local" });
    expect(branchesAfterCreate.map((b) => b.name).sort()).toEqual([
      "feature/x",
      "main",
    ]);

    await git.checkoutBranch(repo, "feature/x");
    const onFeature = await git.listBranches(repo, { kind: "local" });
    expect(onFeature.find((b) => b.name === "feature/x")?.isCurrent).toBe(true);

    await git.checkoutBranch(repo, "main");
    await git.deleteBranch(repo, { name: "feature/x" });
    const branchesAfterDelete = await git.listBranches(repo, { kind: "local" });
    expect(branchesAfterDelete.map((b) => b.name)).toEqual(["main"]);
  });

  it("validateBranchName 对合法/非法名返回正确布尔值", async () => {
    const repo = await makeRepo();
    const git = createGitService();

    expect(await git.validateBranchName(repo, "feature/x")).toBe(true);
    expect(await git.validateBranchName(repo, "..bad")).toBe(false);
  });

  it("resolveRef 对 HEAD 解析为 40 位 oid", async () => {
    const repo = await makeRepo();
    const git = createGitService();

    const oid = await git.resolveRef(repo, "HEAD");
    expect(oid).toMatch(OID_RE);
  });

  it("getFileContent 在 HEAD: 路径拿到提交时的内容", async () => {
    const repo = await makeRepo();
    const git = createGitService();
    // 把工作区文件改了,但 HEAD: 应仍是原始内容
    await writeFile(join(repo, "base.txt"), "WORKTREE CHANGED\n");

    const content = await git.getFileContent(repo, {
      path: "base.txt",
      ref: "HEAD",
    });
    expect(content).toBe("hello\nworld\n");
  });

  it("getCommit + getCommitPatch 对真 oid 返回提交详情和 patch", async () => {
    const repo = await makeRepo();
    const git = createGitService();
    const headOid = await git.resolveRef(repo, "HEAD");

    const commit = await git.getCommit(repo, headOid);
    expect(commit.hash).toBe(headOid);
    expect(commit.message).toBe("initial");

    const patch = await git.getCommitPatch(repo, headOid);
    expect(patch.files[0]?.path).toBe("base.txt");
  });

  it("listTags 在 git tag 后看到该 tag", async () => {
    const repo = await makeRepo();
    const git = createGitService();
    await execGit(["tag", "v0.1.0"], { cwd: repo });

    const tags = await git.listTags(repo);
    expect(tags).toContain("v0.1.0");
  });
});

describe("GitWatchService 端到端(真 fs.watch)", () => {
  it("修改工作区文件,debounce 后真触发 listener", async () => {
    const repo = await makeRepo();
    const watchService = createGitWatchService({
      debounceMs: 50,
      pollMs: 60_000, // 拉长兜底,避免干扰本测试
    });
    const events: Array<{ changeKind: string; gitRoot: string }> = [];

    try {
      watchService.watch(repo, (event) => events.push(event));

      // 等基线签名采集完成(初始 force=true 不触发 listener)
      await new Promise((resolveFn) => setTimeout(resolveFn, 100));

      // 真改文件触发 fs.watch
      await writeFile(join(repo, "base.txt"), "watcher should see this\n");

      // 等 fs event + debounce + 重算签名
      await new Promise((resolveFn) => setTimeout(resolveFn, 500));

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0]?.gitRoot).toBe(repo);
      expect(events[0]?.changeKind).toBe("worktree");
    } finally {
      await watchService.dispose();
    }
  });
});
