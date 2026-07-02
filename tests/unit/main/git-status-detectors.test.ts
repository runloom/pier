import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit as execGitRaw } from "@main/services/git-exec.ts";
import {
  clearDefaultBranchRefCacheForTests,
  detectMergedIntoDefault,
  detectRepoState,
  detectUpstreamGone,
  type ExecGitFn,
  getLineDelta,
  getStashCount,
} from "@main/services/git-status-detectors.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** 真实 execGit 适配为 detectors 期待的 ExecGitFn 形态：(args, cwd, options) → (args, {cwd, ...options})。 */
const execGit: ExecGitFn = (args, cwd, options) =>
  execGitRaw(args, { cwd, ...options });

/** git-common-dir 绝对路径，供 detectMergedIntoDefault 的 gitCommonDir 参数使用。 */
function commonDirOf(dir: string): Promise<string> {
  return execGitRaw(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: dir }
  ).then((s) => s.trim());
}

/** 本地裸仓 + clone，制造真实 origin/HEAD（clone 自带 origin/HEAD → 默认分支）。 */
async function makeClonePair(
  prefix: string
): Promise<{ dir: string; run: (args: string[]) => Promise<string> }> {
  const base = await mkdtemp(join(tmpdir(), prefix));
  const bare = join(base, "remote.git");
  const clone = join(base, "local");
  const raw = (args: string[], cwd: string) => execGitRaw(args, { cwd });
  await raw(["init", "-q", "--bare", "-b", "main", bare], base);
  await raw(["clone", "-q", bare, clone], base);
  await raw(["config", "user.email", "pier@example.com"], clone);
  await raw(["config", "user.name", "Pier Test"], clone);
  const run = (args: string[]) => raw(args, clone);
  await run(["commit", "-q", "--allow-empty", "-m", "init"]);
  await run(["push", "-q", "-u", "origin", "main"]);
  // 克隆时远端仓库为空，git 无法在 clone 时探测默认分支设置 origin/HEAD；
  // 首次 push 后手动补上，让后续测试拿到真实的 refs/remotes/origin/HEAD。
  await run(["remote", "set-head", "origin", "-a"]);
  return { dir: clone, run };
}

describe("detectRepoState", () => {
  let gitDir: string;

  beforeEach(async () => {
    gitDir = await mkdtemp(join(tmpdir(), "pier-detect-repo-state-"));
  });

  afterEach(async () => {
    await rm(gitDir, { force: true, recursive: true });
  });

  it("无操作文件 → clean", async () => {
    const state = await detectRepoState(gitDir, 0);
    expect(state).toEqual({ kind: "clean" });
  });

  it("MERGE_HEAD 存在 → merging；conflictCount 透传", async () => {
    await writeFile(join(gitDir, "MERGE_HEAD"), "abc\n");
    const state = await detectRepoState(gitDir, 3);
    expect(state).toEqual({ conflictCount: 3, kind: "merging" });
  });

  it("CHERRY_PICK_HEAD → cherry-picking", async () => {
    await writeFile(join(gitDir, "CHERRY_PICK_HEAD"), "abc\n");
    const state = await detectRepoState(gitDir, 0);
    expect(state).toEqual({ conflictCount: 0, kind: "cherry-picking" });
  });

  it("REVERT_HEAD → reverting", async () => {
    await writeFile(join(gitDir, "REVERT_HEAD"), "abc\n");
    const state = await detectRepoState(gitDir, 1);
    expect(state).toEqual({ conflictCount: 1, kind: "reverting" });
  });

  it("rebase-merge/ + msgnum + end → rebasing 步进", async () => {
    await mkdir(join(gitDir, "rebase-merge"));
    await writeFile(join(gitDir, "rebase-merge", "msgnum"), "3\n");
    await writeFile(join(gitDir, "rebase-merge", "end"), "8\n");
    const state = await detectRepoState(gitDir, 0);
    expect(state).toEqual({
      conflictCount: 0,
      current: 3,
      kind: "rebasing",
      total: 8,
    });
  });

  it("rebase-apply/ + next + last → rebasing 步进（--am 变体）", async () => {
    await mkdir(join(gitDir, "rebase-apply"));
    await writeFile(join(gitDir, "rebase-apply", "next"), "2\n");
    await writeFile(join(gitDir, "rebase-apply", "last"), "5\n");
    const state = await detectRepoState(gitDir, 0);
    expect(state).toEqual({
      conflictCount: 0,
      current: 2,
      kind: "rebasing",
      total: 5,
    });
  });

  it("rebase 步进文件缺失 → current/total 记 0", async () => {
    await mkdir(join(gitDir, "rebase-merge"));
    const state = await detectRepoState(gitDir, 0);
    expect(state).toEqual({
      conflictCount: 0,
      current: 0,
      kind: "rebasing",
      total: 0,
    });
  });

  it("BISECT_START → bisecting 数 good/bad", async () => {
    await writeFile(join(gitDir, "BISECT_START"), "abc\n");
    await writeFile(
      join(gitDir, "BISECT_LOG"),
      [
        "# status: waiting for both good and bad commits",
        "# bad: [abc] some subject",
        "git bisect bad abc",
        "# good: [def] another",
        "git bisect good def",
        "git bisect good ghi",
      ].join("\n")
    );
    const state = await detectRepoState(gitDir, 0);
    expect(state).toEqual({ bad: 1, good: 2, kind: "bisecting" });
  });

  it("BISECT_START 但无 log → bisecting good=0 bad=0", async () => {
    await writeFile(join(gitDir, "BISECT_START"), "abc\n");
    const state = await detectRepoState(gitDir, 0);
    expect(state).toEqual({ bad: 0, good: 0, kind: "bisecting" });
  });

  it("同时有 MERGE_HEAD 和 BISECT_START → bisecting 优先", async () => {
    await writeFile(join(gitDir, "BISECT_START"), "abc\n");
    await writeFile(join(gitDir, "MERGE_HEAD"), "def\n");
    const state = await detectRepoState(gitDir, 0);
    expect(state.kind).toBe("bisecting");
  });

  it("gitDir 不存在 → clean（fs.access 失败视为文件不存在）", async () => {
    const bogus = join(tmpdir(), "pier-detect-not-exist-12345");
    const state = await detectRepoState(bogus, 0);
    expect(state).toEqual({ kind: "clean" });
  });
});

describe("getLineDelta", () => {
  it("汇总 staged + unstaged 增删；binary 不计入", async () => {
    const execGit: ExecGitFn = (args) => {
      if (args.includes("--cached")) {
        return Promise.resolve("10\t3\tfile1.ts\0-\t-\tbinary.png\0");
      }
      return Promise.resolve("5\t2\tfile2.ts\0");
    };
    const delta = await getLineDelta(execGit, "/repo");
    expect(delta).toEqual({ deletions: 5, insertions: 15 });
  });

  it("execGit 抛出 → null", async () => {
    const execGit: ExecGitFn = () => Promise.reject(new Error("boom"));
    const delta = await getLineDelta(execGit, "/repo");
    expect(delta).toBeNull();
  });

  it("空输出 → 0/0", async () => {
    const execGit: ExecGitFn = () => Promise.resolve("");
    const delta = await getLineDelta(execGit, "/repo");
    expect(delta).toEqual({ deletions: 0, insertions: 0 });
  });
});

describe("getStashCount", () => {
  it("rev-list 返回数字", async () => {
    const execGit: ExecGitFn = (args) => {
      expect(args).toEqual([
        "rev-list",
        "--walk-reflogs",
        "--count",
        "refs/stash",
      ]);
      return Promise.resolve("3\n");
    };
    expect(await getStashCount(execGit, "/repo")).toBe(3);
  });

  it("refs/stash 不存在 → 0（execGit reject）", async () => {
    const execGit: ExecGitFn = () =>
      Promise.reject(new Error("unknown revision"));
    expect(await getStashCount(execGit, "/repo")).toBe(0);
  });

  it("非数字输出 → 0", async () => {
    const execGit: ExecGitFn = () => Promise.resolve("nope\n");
    expect(await getStashCount(execGit, "/repo")).toBe(0);
  });
});

describe("detectUpstreamGone", () => {
  it("upstream:track 含 [gone] → true", async () => {
    const execGit: ExecGitFn = (args) => {
      expect(args).toContain("refs/heads/feature/x");
      return Promise.resolve("[gone]\n");
    };
    expect(await detectUpstreamGone(execGit, "/repo", "feature/x")).toBe(true);
  });

  it("upstream:track 不含 [gone] → false", async () => {
    const execGit: ExecGitFn = () => Promise.resolve("[ahead 2]\n");
    expect(await detectUpstreamGone(execGit, "/repo", "main")).toBe(false);
  });

  it("branch 为 null → false（不调用 execGit）", async () => {
    let called = false;
    const execGit: ExecGitFn = () => {
      called = true;
      return Promise.resolve("");
    };
    expect(await detectUpstreamGone(execGit, "/repo", null)).toBe(false);
    expect(called).toBe(false);
  });

  it("execGit reject → false", async () => {
    const execGit: ExecGitFn = () => Promise.reject(new Error("boom"));
    expect(await detectUpstreamGone(execGit, "/repo", "main")).toBe(false);
  });
});

describe("detectMergedIntoDefault", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    clearDefaultBranchRefCacheForTests();
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
    );
  });

  it("merge 合入默认分支后为 true", async () => {
    const { dir, run } = await makeClonePair("pier-merged-");
    tempDirs.push(join(dir, ".."));
    await run(["checkout", "-q", "-b", "feature/a"]);
    await run(["commit", "-q", "--allow-empty", "-m", "work"]);
    await run(["checkout", "-q", "main"]);
    await run(["merge", "-q", "--no-ff", "feature/a", "-m", "merge"]);
    await run(["push", "-q", "origin", "main"]);
    await run(["checkout", "-q", "feature/a"]);
    const result = await detectMergedIntoDefault(
      execGit,
      dir,
      "feature/a",
      await commonDirOf(dir)
    );
    expect(result).toBe(true);
  });

  it("未合入时为 false", async () => {
    const { dir, run } = await makeClonePair("pier-unmerged-");
    tempDirs.push(join(dir, ".."));
    await run(["checkout", "-q", "-b", "feature/b"]);
    await run(["commit", "-q", "--allow-empty", "-m", "wip"]);
    const result = await detectMergedIntoDefault(
      execGit,
      dir,
      "feature/b",
      await commonDirOf(dir)
    );
    expect(result).toBe(false);
  });

  it("squash 合入检测不到（已知限制，记 false）", async () => {
    const { dir, run } = await makeClonePair("pier-squash-");
    tempDirs.push(join(dir, ".."));
    await run(["checkout", "-q", "-b", "feature/c"]);
    await writeFile(join(dir, "f.txt"), "x");
    await run(["add", "f.txt"]);
    await run(["commit", "-q", "-m", "work"]);
    await run(["checkout", "-q", "main"]);
    await run(["merge", "-q", "--squash", "feature/c"]);
    await run(["commit", "-q", "-m", "squashed"]);
    await run(["push", "-q", "origin", "main"]);
    await run(["checkout", "-q", "feature/c"]);
    const result = await detectMergedIntoDefault(
      execGit,
      dir,
      "feature/c",
      await commonDirOf(dir)
    );
    expect(result).toBe(false);
  });

  it("无 origin/HEAD（本地 init 仓库）为 null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-noremote-"));
    tempDirs.push(dir);
    await execGitRaw(["init", "-q", "-b", "main"], { cwd: dir });
    await execGitRaw(["config", "user.email", "pier@example.com"], {
      cwd: dir,
    });
    await execGitRaw(["config", "user.name", "Pier Test"], { cwd: dir });
    await execGitRaw(["commit", "-q", "--allow-empty", "-m", "init"], {
      cwd: dir,
    });
    const result = await detectMergedIntoDefault(
      execGit,
      dir,
      "main",
      await commonDirOf(dir)
    );
    expect(result).toBe(null);
  });

  it("当前就在默认分支上为 null", async () => {
    const { dir } = await makeClonePair("pier-ondefault-");
    tempDirs.push(join(dir, ".."));
    const result = await detectMergedIntoDefault(
      execGit,
      dir,
      "main",
      await commonDirOf(dir)
    );
    expect(result).toBe(null);
  });

  it("detached（branch 为 null）为 null", async () => {
    const { dir } = await makeClonePair("pier-detached-");
    tempDirs.push(join(dir, ".."));
    const result = await detectMergedIntoDefault(
      execGit,
      dir,
      null,
      await commonDirOf(dir)
    );
    expect(result).toBe(null);
  });
});
