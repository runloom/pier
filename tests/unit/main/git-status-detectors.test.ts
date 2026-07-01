import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectRepoState,
  detectUpstreamGone,
  type ExecGitFn,
  getLineDelta,
  getStashCount,
} from "@main/services/git-status-detectors.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
