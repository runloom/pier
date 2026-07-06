import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit as execGitRaw } from "@main/services/git-exec.ts";
import {
  clearMergedMemoForTests,
  detectMergedIntoDefault,
} from "@main/services/git-merged-detector.ts";
import {
  type DefaultBranchCandidates,
  defaultBranchCandidates,
  fetchRefsTable,
  type RefsTable,
} from "@main/services/git-refs-table.ts";
import {
  detectRepoState,
  type ExecGitFn,
  getLineDelta,
  getStashCount,
} from "@main/services/git-status-detectors.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** 真实 execGit 适配为 detectors 期待的 ExecGitFn 形态：(args, cwd, options) → (args, {cwd, ...options})。 */
const execGit: ExecGitFn = (args, cwd, options) =>
  execGitRaw(args, { cwd, ...options });

/** 当前 checkout 的 HEAD oid，供 detectMergedIntoDefault 的 headOid 参数使用。 */
function headOidOf(dir: string): Promise<string> {
  return execGitRaw(["rev-parse", "HEAD"], { cwd: dir }).then((s) => s.trim());
}

/** 从真实仓库解析默认分支候选（与装配层同路径：for-each-ref 表 → 候选）。 */
async function candidatesOf(dir: string): Promise<DefaultBranchCandidates> {
  const table = await fetchRefsTable(
    (args, cwd) => execGitRaw(args, { cwd }),
    dir
  );
  if (table === null) {
    throw new Error(`refs table unavailable: ${dir}`);
  }
  return defaultBranchCandidates(table);
}

function upstreamShortNameFor(
  table: RefsTable,
  branch: string | null
): string | null {
  if (branch === null) {
    return null;
  }
  const refname = `refs/heads/${branch}`;
  const upstream = table.entries.find(
    (entry) => entry.refname === refname
  )?.upstream;
  if (!upstream) {
    return null;
  }
  if (upstream.startsWith("refs/remotes/")) {
    return upstream.split("/").slice(2).join("/");
  }
  if (upstream.startsWith("refs/heads/")) {
    return upstream.split("/").slice(2).join("/");
  }
  return upstream;
}

/** 多数场景的公共路径：现取 (headOid, candidates) 后调用被测函数。 */
async function detectFor(
  dir: string,
  branch: string | null
): Promise<boolean | null> {
  const table = await fetchRefsTable(
    (args, cwd) => execGitRaw(args, { cwd }),
    dir
  );
  if (table === null) {
    throw new Error(`refs table unavailable: ${dir}`);
  }
  return detectMergedIntoDefault(
    execGit,
    dir,
    branch,
    await headOidOf(dir),
    defaultBranchCandidates(table),
    upstreamShortNameFor(table, branch)
  );
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

describe("detectMergedIntoDefault", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    clearMergedMemoForTests();
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
    );
  });

  it("从默认分支 tip 新建分支（零自有提交）→ false", async () => {
    const { dir, run } = await makeClonePair("pier-merged-fresh-");
    tempDirs.push(join(dir, ".."));
    await run(["checkout", "-q", "-b", "feature/fresh"]);
    expect(await detectFor(dir, "feature/fresh")).toBe(false);
  });

  it("新建分支后 main 继续前进（HEAD 在默认分支历史里但无自有提交）→ false", async () => {
    const { dir, run } = await makeClonePair("pier-merged-behind-");
    tempDirs.push(join(dir, ".."));
    await run(["checkout", "-q", "-b", "feature/behind"]);
    await run(["checkout", "-q", "main"]);
    await run(["commit", "-q", "--allow-empty", "-m", "main ahead"]);
    await run(["push", "-q", "origin", "main"]);
    await run(["checkout", "-q", "feature/behind"]);
    expect(await detectFor(dir, "feature/behind")).toBe(false);
  });

  it("分支有自有提交、未合入 → false", async () => {
    const { dir, run } = await makeClonePair("pier-merged-unmerged-");
    tempDirs.push(join(dir, ".."));
    await run(["checkout", "-q", "-b", "feature/wip"]);
    await run(["commit", "-q", "--allow-empty", "-m", "wip"]);
    expect(await detectFor(dir, "feature/wip")).toBe(false);
  });

  it("merge --no-ff 合入并 push → true；main 再前进一个提交后仍 true", async () => {
    const { dir, run } = await makeClonePair("pier-merged-noff-");
    tempDirs.push(join(dir, ".."));
    await run(["checkout", "-q", "-b", "feature/a"]);
    await writeFile(join(dir, "a.txt"), "a\n");
    await run(["add", "a.txt"]);
    await run(["commit", "-q", "-m", "work"]);
    await run(["checkout", "-q", "main"]);
    await run(["merge", "-q", "--no-ff", "feature/a", "-m", "merge feature/a"]);
    await run(["push", "-q", "origin", "main"]);
    await run(["checkout", "-q", "feature/a"]);
    expect(await detectFor(dir, "feature/a")).toBe(true);

    // main 前进后 HEAD 仍经 merge commit 汇入主链，判定不退化
    await run(["checkout", "-q", "main"]);
    await run(["commit", "-q", "--allow-empty", "-m", "after merge"]);
    await run(["push", "-q", "origin", "main"]);
    await run(["checkout", "-q", "feature/a"]);
    expect(await detectFor(dir, "feature/a")).toBe(true);
  });

  it("ff 合并（默认分支 tip 已包含当前分支 tip）→ true", async () => {
    const { dir, run } = await makeClonePair("pier-merged-ff-");
    tempDirs.push(join(dir, ".."));
    await run(["checkout", "-q", "-b", "feature/ff"]);
    await run(["commit", "-q", "--allow-empty", "-m", "work"]);
    await run(["checkout", "-q", "main"]);
    await run(["merge", "-q", "--ff-only", "feature/ff"]);
    await run(["push", "-q", "origin", "main"]);
    await run(["checkout", "-q", "feature/ff"]);
    expect(await detectFor(dir, "feature/ff")).toBe(true);
  });

  it("远端分支 ff 合入默认分支后，本地同名分支 → true", async () => {
    const { dir, run } = await makeClonePair("pier-merged-remote-ff-");
    tempDirs.push(join(dir, ".."));
    await run(["checkout", "-q", "-b", "feature/remote-ff"]);
    await run(["commit", "-q", "--allow-empty", "-m", "work"]);
    await run(["push", "-q", "-u", "origin", "feature/remote-ff"]);
    await run(["checkout", "-q", "main"]);
    await run(["merge", "-q", "--ff-only", "origin/feature/remote-ff"]);
    await run(["push", "-q", "origin", "main"]);
    await run(["checkout", "-q", "feature/remote-ff"]);
    expect(await detectFor(dir, "feature/remote-ff")).toBe(true);
  });

  it("同名旧分支曾 ff 合入，新建零自有提交分支不复用旧 reflog 证据 → false", async () => {
    const { dir } = await makeClonePair("pier-merged-reused-branch-");
    tempDirs.push(join(dir, ".."));
    const runAt = (date: string, args: string[]) =>
      execGitRaw(args, {
        cwd: dir,
        env: { GIT_COMMITTER_DATE: date },
      });

    await runAt("2026-01-01T00:00:00Z", [
      "checkout",
      "-q",
      "-b",
      "feature/reuse",
    ]);
    await runAt("2026-01-01T00:00:10Z", [
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "work",
    ]);
    await runAt("2026-01-01T00:00:20Z", ["checkout", "-q", "main"]);
    await runAt("2026-01-01T00:00:30Z", [
      "merge",
      "-q",
      "--ff-only",
      "feature/reuse",
    ]);
    await runAt("2026-01-01T00:00:35Z", ["checkout", "-q", "feature/reuse"]);
    expect(await detectFor(dir, "feature/reuse")).toBe(true);
    await runAt("2026-01-01T00:00:36Z", ["checkout", "-q", "main"]);
    await runAt("2026-01-01T00:00:40Z", ["branch", "-D", "feature/reuse"]);
    await runAt("2026-01-01T00:00:50Z", [
      "checkout",
      "-q",
      "-b",
      "feature/reuse",
    ]);

    expect(await detectFor(dir, "feature/reuse")).toBe(false);
  });

  it("HEAD 等于默认分支 tip 但无匹配 ff reflog 证据 → false", async () => {
    const headOid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const calls: string[] = [];
    const fakeExec: ExecGitFn = (args, cwd) => {
      calls.push(`${cwd} ${args.join(" ")}`);
      if (args.join(" ") === `merge-base --is-ancestor ${headOid} ${headOid}`) {
        return Promise.resolve("");
      }
      if (
        args[0] === "reflog" &&
        args[1] === "show" &&
        args.at(-1) === "refs/heads/main"
      ) {
        return Promise.resolve(`${300}\0${headOid}\0fetch: fast-forward\n`);
      }
      if (
        args[0] === "reflog" &&
        args[1] === "show" &&
        args.at(-1) === "refs/heads/feature/no-proof"
      ) {
        return Promise.resolve(
          [
            `${200}\0${headOid}\0commit: work`,
            `${100}\0bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\0branch: Created from main`,
          ].join("\n")
        );
      }
      return Promise.reject(
        new Error(`unexpected git call: ${args.join(" ")}`)
      );
    };

    expect(
      await detectMergedIntoDefault(
        fakeExec,
        "/repo/no-proof",
        "feature/no-proof",
        headOid,
        {
          local: {
            branchName: "main",
            oid: headOid,
            refname: "refs/heads/main",
          },
          remote: null,
        }
      )
    ).toBe(false);
    expect(calls).toContain(
      "/repo/no-proof reflog show --format=%ct%x00%H%x00%gs refs/heads/main"
    );
  });

  it("单提交分支被 squash 合入 → true（cherry patch 等价路径）", async () => {
    const { dir, run } = await makeClonePair("pier-merged-squash1-");
    tempDirs.push(join(dir, ".."));
    await run(["checkout", "-q", "-b", "feature/sq1"]);
    await writeFile(join(dir, "sq.txt"), "content\n");
    await run(["add", "sq.txt"]);
    await run(["commit", "-q", "-m", "work"]);
    await run(["checkout", "-q", "main"]);
    await run(["merge", "-q", "--squash", "feature/sq1"]);
    await run(["commit", "-q", "-m", "squashed"]);
    await run(["push", "-q", "origin", "main"]);
    await run(["checkout", "-q", "feature/sq1"]);
    expect(await detectFor(dir, "feature/sq1")).toBe(true);
  });

  it("双提交 squash（N 压 1，patch-id 对不上）→ false（已知限制固化）", async () => {
    const { dir, run } = await makeClonePair("pier-merged-squash2-");
    tempDirs.push(join(dir, ".."));
    await run(["checkout", "-q", "-b", "feature/sq2"]);
    await writeFile(join(dir, "sq-a.txt"), "a\n");
    await run(["add", "sq-a.txt"]);
    await run(["commit", "-q", "-m", "part a"]);
    await writeFile(join(dir, "sq-b.txt"), "b\n");
    await run(["add", "sq-b.txt"]);
    await run(["commit", "-q", "-m", "part b"]);
    await run(["checkout", "-q", "main"]);
    await run(["merge", "-q", "--squash", "feature/sq2"]);
    await run(["commit", "-q", "-m", "squashed both"]);
    await run(["push", "-q", "origin", "main"]);
    await run(["checkout", "-q", "feature/sq2"]);
    expect(await detectFor(dir, "feature/sq2")).toBe(false);
  });

  it("rebase-merge（提交重放到 main 后 ff）→ true（cherry patch 等价路径）", async () => {
    const { dir, run } = await makeClonePair("pier-merged-rebase-");
    tempDirs.push(join(dir, ".."));
    await run(["checkout", "-q", "-b", "feature/rb"]);
    await writeFile(join(dir, "rb.txt"), "rb\n");
    await run(["add", "rb.txt"]);
    await run(["commit", "-q", "-m", "feature work"]);
    // main 先前进，让 rebase 真正产生新 oid（否则退化成 ff）
    await run(["checkout", "-q", "main"]);
    await writeFile(join(dir, "other.txt"), "other\n");
    await run(["add", "other.txt"]);
    await run(["commit", "-q", "-m", "main advance"]);
    // 模拟 GitHub rebase-merge：feature 提交重放到 main 顶端后 ff 合入
    await run(["checkout", "-q", "-b", "feature/rb-replay", "feature/rb"]);
    await run(["rebase", "-q", "main"]);
    await run(["checkout", "-q", "main"]);
    await run(["merge", "-q", "--ff-only", "feature/rb-replay"]);
    await run(["push", "-q", "origin", "main"]);
    await run(["checkout", "-q", "feature/rb"]);
    expect(await detectFor(dir, "feature/rb")).toBe(true);
  });

  it("只合入本地同名默认分支、未 push → true（local 候选命中）", async () => {
    const { dir, run } = await makeClonePair("pier-merged-local-");
    tempDirs.push(join(dir, ".."));
    await run(["checkout", "-q", "-b", "feature/local"]);
    await writeFile(join(dir, "l.txt"), "l\n");
    await run(["add", "l.txt"]);
    await run(["commit", "-q", "-m", "work"]);
    await run(["checkout", "-q", "main"]);
    await run(["merge", "-q", "--no-ff", "feature/local", "-m", "merge local"]);
    // 不 push：origin/main 仍停在 init，仅本地 main 含合并
    await run(["checkout", "-q", "feature/local"]);
    expect(await detectFor(dir, "feature/local")).toBe(true);
  });

  it("自身就是默认分支 → null", async () => {
    const { dir } = await makeClonePair("pier-merged-ondefault-");
    tempDirs.push(join(dir, ".."));
    expect(await detectFor(dir, "main")).toBe(null);
  });

  it("detached（branch null）/ headOid null → null", async () => {
    const { dir } = await makeClonePair("pier-merged-detached-");
    tempDirs.push(join(dir, ".."));
    expect(await detectFor(dir, null)).toBe(null);
    const candidates = await candidatesOf(dir);
    expect(
      await detectMergedIntoDefault(execGit, dir, "feature/x", null, candidates)
    ).toBe(null);
  });

  it("无任何默认分支候选（本地 init 仓库，无 remote HEAD）→ null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-merged-nocand-"));
    tempDirs.push(dir);
    await execGitRaw(["init", "-q", "-b", "main"], { cwd: dir });
    await execGitRaw(["config", "user.email", "pier@example.com"], {
      cwd: dir,
    });
    await execGitRaw(["config", "user.name", "Pier Test"], { cwd: dir });
    await execGitRaw(["commit", "-q", "--allow-empty", "-m", "init"], {
      cwd: dir,
    });
    // 不在默认分支上也一样：候选双 null 直接判 null
    await execGitRaw(["checkout", "-q", "-b", "feature/x"], { cwd: dir });
    expect(await detectFor(dir, "feature/x")).toBe(null);
  });

  it("memo：同 (headOid, tipOid) 第二次调用不再 spawn 图查询", async () => {
    const { dir, run } = await makeClonePair("pier-merged-memo-");
    tempDirs.push(join(dir, ".."));
    await run(["checkout", "-q", "-b", "feature/memo"]);
    await run(["commit", "-q", "--allow-empty", "-m", "work"]);
    await run(["checkout", "-q", "main"]);
    await run(["merge", "-q", "--no-ff", "feature/memo", "-m", "merge"]);
    await run(["push", "-q", "origin", "main"]);
    await run(["checkout", "-q", "feature/memo"]);

    let graphCalls = 0;
    const countingExec: ExecGitFn = (args, cwd, options) => {
      graphCalls += 1;
      return execGit(args, cwd, options);
    };
    const headOid = await headOidOf(dir);
    const candidates = await candidatesOf(dir);

    expect(
      await detectMergedIntoDefault(
        countingExec,
        dir,
        "feature/memo",
        headOid,
        candidates
      )
    ).toBe(true);
    expect(graphCalls).toBeGreaterThan(0);

    const callsAfterFirst = graphCalls;
    expect(
      await detectMergedIntoDefault(
        countingExec,
        dir,
        "feature/memo",
        headOid,
        candidates
      )
    ).toBe(true);
    // memo 命中：不再发起任何 git 图查询
    expect(graphCalls).toBe(callsAfterFirst);
  });

  it("memo key 按仓库路径隔离，避免复用另一个 clone 的 reflog 证据", async () => {
    const headOid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const tip = {
      branchName: "main",
      oid: headOid,
      refname: "refs/heads/main",
    };
    const fakeExec: ExecGitFn = (args, cwd) => {
      if (args[0] === "merge-base") {
        return Promise.resolve("");
      }
      if (
        args[0] === "reflog" &&
        args[1] === "show" &&
        args.at(-1) === "refs/heads/main"
      ) {
        return Promise.resolve(
          cwd === "/repo/with-proof"
            ? `${200}\0${headOid}\0merge feature/x: Fast-forward\n`
            : `${200}\0${headOid}\0fetch: fast-forward\n`
        );
      }
      if (
        args[0] === "reflog" &&
        args[1] === "show" &&
        args.at(-1) === "refs/heads/feature/x"
      ) {
        return Promise.resolve(
          [
            `${100}\0${headOid}\0commit: work`,
            `${50}\0bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\0branch: Created from main`,
          ].join("\n")
        );
      }
      return Promise.reject(
        new Error(`unexpected git call: ${args.join(" ")}`)
      );
    };

    await expect(
      detectMergedIntoDefault(
        fakeExec,
        "/repo/with-proof",
        "feature/x",
        headOid,
        { local: tip, remote: null }
      )
    ).resolves.toBe(true);
    await expect(
      detectMergedIntoDefault(
        fakeExec,
        "/repo/without-proof",
        "feature/x",
        headOid,
        { local: tip, remote: null }
      )
    ).resolves.toBe(false);
  });
});
