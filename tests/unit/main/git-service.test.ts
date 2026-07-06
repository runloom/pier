import { GitExecError } from "@main/services/git-exec.ts";
import {
  parseGitBranchRefs,
  parseGitLog,
  parseGitNumstat,
  parseGitStatus,
  parseUnifiedDiff,
} from "@main/services/git-parsers.ts";
import { createGitService } from "@main/services/git-service.ts";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  default: {
    realpath: vi.fn(async (target: string) => target),
    stat: vi.fn(async () => ({ isDirectory: () => true })),
  },
  realpath: vi.fn(async (target: string) => target),
  stat: vi.fn(async () => ({ isDirectory: () => true })),
}));

function isGitRootRequest(args: readonly string[]): boolean {
  return (
    args.length === 2 &&
    args[0] === "rev-parse" &&
    args[1] === "--show-toplevel"
  );
}

describe("parseGitStatus", () => {
  it("解析 branch header 的分支名与 ahead/behind", () => {
    const output = `${[
      "# branch.oid abc123",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
    ].join("\0")}\0`;

    const result = parseGitStatus(output);

    expect(result.branch).toEqual({
      ahead: 2,
      behind: 1,
      branch: "main",
      oid: "abc123",
      upstream: "origin/main",
    });
    expect(result.files).toEqual([]);
  });

  it("无上游分支时 ahead/behind 为 0、upstream 为 null", () => {
    const output = `${["# branch.head main"].join("\0")}\0`;

    expect(parseGitStatus(output).branch).toEqual({
      ahead: 0,
      behind: 0,
      branch: "main",
      oid: null,
      upstream: null,
    });
  });

  it("detached HEAD 时 branch 为 null，oid 保留可用于 UI 短 sha", () => {
    const output = `${["# branch.oid 5c8f9a1", "# branch.head (detached)"].join(
      "\0"
    )}\0`;

    const parsed = parseGitStatus(output);
    expect(parsed.branch.branch).toBeNull();
    expect(parsed.branch.oid).toBe("5c8f9a1");
  });

  it("空仓库 `# branch.oid (initial)` → oid 为 null", () => {
    const output = "# branch.oid (initial)\0";

    expect(parseGitStatus(output).branch.oid).toBeNull();
  });

  it("解析 ordinary 变更文件的 XY 状态码与路径", () => {
    const output = `${[
      "# branch.head main",
      "1 .M N... 100644 100644 100644 aaa bbb src/foo.ts",
    ].join("\0")}\0`;

    expect(parseGitStatus(output).files).toEqual([
      { index: ".", origPath: null, path: "src/foo.ts", worktree: "M" },
    ]);
  });

  it("解析 untracked 文件", () => {
    const output = `${["# branch.head main", "? new file.ts"].join("\0")}\0`;

    expect(parseGitStatus(output).files).toEqual([
      { index: "?", origPath: null, path: "new file.ts", worktree: "?" },
    ]);
  });

  it("解析 renamed 文件(含 origPath)", () => {
    const output = `${[
      "# branch.head main",
      "2 R. N... 100644 100644 100644 aaa bbb R100 newname.ts",
      "oldname.ts",
    ].join("\0")}\0`;

    expect(parseGitStatus(output).files).toEqual([
      { index: "R", origPath: "oldname.ts", path: "newname.ts", worktree: "." },
    ]);
  });

  // C1: porcelain v2 "u" unmerged 条目（冲突文件）
  // 格式: u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
  it("解析 unmerged(冲突)文件", () => {
    const output = `${[
      "# branch.head main",
      "u UU N... 100644 100644 100644 100644 oid1 oid2 oid3 src/conflict.ts",
    ].join("\0")}\0`;

    expect(parseGitStatus(output).files).toEqual([
      { index: "U", origPath: null, path: "src/conflict.ts", worktree: "U" },
    ]);
  });
});

describe("parseGitLog", () => {
  it("解析多条 log 记录的 hash/author/date/message", () => {
    const output = `${[
      ["abc123", "Alice", "2026-06-01T10:00:00+08:00", "feat: 初始化"].join(
        "\x1f"
      ),
      ["def456", "Bob", "2026-06-02T11:00:00+08:00", "fix: 修复换行"].join(
        "\x1f"
      ),
    ].join("\x1e")}\x1e`;

    expect(parseGitLog(output)).toEqual([
      {
        author: "Alice",
        date: "2026-06-01T10:00:00+08:00",
        hash: "abc123",
        message: "feat: 初始化",
      },
      {
        author: "Bob",
        date: "2026-06-02T11:00:00+08:00",
        hash: "def456",
        message: "fix: 修复换行",
      },
    ]);
  });

  it("空输出返回空数组", () => {
    expect(parseGitLog("")).toEqual([]);
  });
});

describe("parseGitNumstat", () => {
  it("解析普通文件的增删行数", () => {
    const output = `${["10\t2\tsrc/foo.ts"].join("\0")}\0`;

    expect(parseGitNumstat(output)).toEqual([
      { binary: false, deletions: 2, insertions: 10, path: "src/foo.ts" },
    ]);
  });

  it("binary 文件 insertions/deletions 记为 0、binary 为 true", () => {
    const output = "-\t-\timg.png\0";

    expect(parseGitNumstat(output)).toEqual([
      { binary: true, deletions: 0, insertions: 0, path: "img.png" },
    ]);
  });

  // C2: 路径含 tab 时不应被截断（-z 只保 NUL 分隔，不保 path 无 tab）
  it("路径含 tab 字符不被截断", () => {
    const output = "10\t2\tpath/with\ttab.ts\0";

    expect(parseGitNumstat(output)).toEqual([
      {
        binary: false,
        deletions: 2,
        insertions: 10,
        path: "path/with\ttab.ts",
      },
    ]);
  });
});

describe("parseUnifiedDiff", () => {
  it("解析单文件单 hunk 的 add/del/context 行", () => {
    const text = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index abc..def 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,4 @@",
      " line1",
      "-old line",
      "+new line",
      "+another",
      " line3",
      "",
    ].join("\n");

    expect(parseUnifiedDiff(text)).toEqual({
      files: [
        {
          binary: false,
          hunks: [
            {
              lines: [
                { kind: "context", text: "line1" },
                { kind: "del", text: "old line" },
                { kind: "add", text: "new line" },
                { kind: "add", text: "another" },
                { kind: "context", text: "line3" },
              ],
              newLines: 4,
              newStart: 1,
              oldLines: 3,
              oldStart: 1,
            },
          ],
          oldPath: null,
          path: "src/a.ts",
        },
      ],
    });
  });

  it("解析 binary 文件：无 hunks、binary=true", () => {
    const text = [
      "diff --git a/img.png b/img.png",
      "Binary files a/img.png and b/img.png differ",
      "",
    ].join("\n");

    expect(parseUnifiedDiff(text).files).toEqual([
      { binary: true, hunks: [], oldPath: null, path: "img.png" },
    ]);
  });

  it("解析 rename：oldPath !== path", () => {
    const text = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 100%",
      "rename from old.ts",
      "rename to new.ts",
      "",
    ].join("\n");

    const result = parseUnifiedDiff(text).files[0];
    expect(result?.path).toBe("new.ts");
    expect(result?.oldPath).toBe("old.ts");
  });
});

describe("parseGitBranchRefs", () => {
  it("解析 for-each-ref --format=%(refname)%00%(upstream:short)%00%(objectname)%00%(HEAD) 输出", () => {
    const output = `${[
      ["refs/heads/main", "origin/main", "abc123", "*"].join("\0"),
      ["refs/heads/feature/a", "", "def456", " "].join("\0"),
      ["refs/remotes/origin/HEAD", "", "abc123", " "].join("\0"),
      ["refs/remotes/origin/main", "", "abc123", " "].join("\0"),
    ].join("\n")}\n`;

    expect(parseGitBranchRefs(output)).toEqual([
      {
        isCurrent: true,
        kind: "local",
        lastCommit: "abc123",
        name: "main",
        upstream: "origin/main",
      },
      {
        isCurrent: false,
        kind: "local",
        lastCommit: "def456",
        name: "feature/a",
        upstream: null,
      },
      {
        isCurrent: false,
        kind: "remote",
        lastCommit: "abc123",
        name: "origin/main",
        upstream: null,
      },
    ]);
  });
});

describe("createGitService", () => {
  it("getStatus 汇总 status + delta + stash + repoState + upstreamGone", async () => {
    const argSets: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args, cwd) => {
        argSets.push(args);
        if (args[0] === "status") {
          expect(cwd).toBe("/repo");
          return Promise.resolve(
            `${[
              "# branch.head main",
              "# branch.upstream origin/main",
              "1 .M N... 100644 100644 100644 a b src/foo.ts",
            ].join("\0")}\0`
          );
        }
        if (args[0] === "diff") {
          // staged 与 unstaged 都返回 numstat
          return Promise.resolve(
            args.includes("--cached") ? "5\t2\ta.ts\0" : "3\t1\tb.ts\0"
          );
        }
        if (args[0] === "rev-list") {
          // stash count
          return Promise.resolve("2\n");
        }
        if (args[0] === "rev-parse") {
          // gitDir
          return Promise.resolve("/tmp/nonexistent-gitdir\n");
        }
        if (args[0] === "for-each-ref") {
          // upstream track
          return Promise.resolve("[ahead 1]\n");
        }
        return Promise.resolve("");
      },
    });

    const status = await service.getStatus("/repo");

    expect(argSets.some((a) => a[0] === "status")).toBe(true);
    expect(argSets.some((a) => a[0] === "diff" && a.includes("--cached"))).toBe(
      true
    );
    expect(
      argSets.some((a) => a[0] === "diff" && !a.includes("--cached"))
    ).toBe(true);
    expect(argSets.some((a) => a[0] === "rev-list")).toBe(true);
    expect(argSets.some((a) => a[0] === "for-each-ref")).toBe(true);
    expect(status.branch.branch).toBe("main");
    expect(status.branch.upstreamGone).toBe(false);
    expect(status.files).toHaveLength(1);
    expect(status.counts).toEqual({
      conflict: 0,
      modified: 1,
      staged: 0,
      untracked: 0,
    });
    expect(status.delta).toEqual({ deletions: 3, insertions: 8 });
    expect(status.stashCount).toBe(2);
    expect(status.repoState).toEqual({ kind: "clean" });
  });

  // A7: 传 prefetched 时跳过 status 与两条 numstat spawn，结果与不传等价
  it("getStatus 传 prefetched 时不再 spawn status/numstat，结果与不传等价", async () => {
    const statusOut = `${[
      "# branch.head main",
      "# branch.upstream origin/main",
      "1 .M N... 100644 100644 100644 a b src/foo.ts",
    ].join("\0")}\0`;
    const unstagedNumstat = "3\t1\tb.ts\0";
    const stagedNumstat = "5\t2\ta.ts\0";
    const makeExec =
      (record: Array<readonly string[]>) =>
      (args: readonly string[]): Promise<string> => {
        record.push(args);
        if (args[0] === "status") {
          return Promise.resolve(statusOut);
        }
        if (args[0] === "diff") {
          return Promise.resolve(
            args.includes("--cached") ? stagedNumstat : unstagedNumstat
          );
        }
        if (args[0] === "rev-list") {
          return Promise.resolve("2\n");
        }
        if (args[0] === "rev-parse") {
          return Promise.resolve("/tmp/nonexistent-gitdir\n");
        }
        if (args[0] === "for-each-ref") {
          return Promise.resolve("[ahead 1]\n");
        }
        return Promise.resolve("");
      };

    const plainCalls: Array<readonly string[]> = [];
    const plainService = createGitService({ execGit: makeExec(plainCalls) });
    const plain = await plainService.getStatus("/repo");

    const prefetchedCalls: Array<readonly string[]> = [];
    const prefetchedService = createGitService({
      execGit: makeExec(prefetchedCalls),
    });
    const prefetched = await prefetchedService.getStatus("/repo", {
      stagedNumstat,
      statusOut,
      unstagedNumstat,
    });

    // 等价
    expect(prefetched).toEqual(plain);
    // 预取路径不再调 status
    expect(prefetchedCalls.some((a) => a[0] === "status")).toBe(false);
    // 预取路径不再调 numstat（diff --numstat）
    expect(
      prefetchedCalls.some((a) => a[0] === "diff" && a.includes("--numstat"))
    ).toBe(false);
    // 其余命令照跑
    expect(prefetchedCalls.some((a) => a[0] === "rev-list")).toBe(true);
    expect(prefetchedCalls.some((a) => a[0] === "for-each-ref")).toBe(true);
  });

  // C3: 默认带 --no-color + --no-ext-diff（防用户配 diff.external 覆盖输出）
  it("getDiffText 默认带 --no-color --no-ext-diff 并原样返回文本", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve("diff --git a/x b/x\n");
      },
    });

    await expect(service.getDiffText("/repo")).resolves.toBe(
      "diff --git a/x b/x\n"
    );
    expect(calls[0]).toEqual(["diff", "--no-color", "--no-ext-diff"]);
  });

  it("getDiffText 的 staged 选项加 --cached", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve("");
      },
    });

    await service.getDiffText("/repo", { staged: true });

    expect(calls[0]).toEqual([
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--cached",
    ]);
  });

  it("getDiffText 拒绝以 dash 开头的 revision 参数", () => {
    const service = createGitService({
      execGit: () => Promise.resolve(""),
    });

    expect(() =>
      service.getDiffText("/repo", { from: "--output=/tmp/pwned" })
    ).toThrow('diff from must not start with "-"');
    expect(() =>
      service.getDiffText("/repo", { from: "HEAD", to: "--output=/tmp/pwned" })
    ).toThrow('diff to must not start with "-"');
  });

  it("getDiffSummary 解析 numstat 并汇总增删", async () => {
    const service = createGitService({
      execGit: () =>
        Promise.resolve(`${["10\t2\ta.ts", "3\t1\tb.ts"].join("\0")}\0`),
    });

    await expect(service.getDiffSummary("/repo")).resolves.toEqual({
      changed: 2,
      deletions: 3,
      files: [
        { binary: false, deletions: 2, insertions: 10, path: "a.ts" },
        { binary: false, deletions: 1, insertions: 3, path: "b.ts" },
      ],
      insertions: 13,
    });
  });

  // B: getRepoInfo
  it("getRepoInfo 普通仓库返回 gitRoot/commonDir/headOid + isBare=false isWorktree=false", async () => {
    const service = createGitService({
      execGit: (args) => {
        if (args[0] === "rev-parse" && args.includes("--show-toplevel")) {
          return Promise.resolve("/repo\n/repo/.git\n/repo/.git\n");
        }
        if (args[0] === "rev-parse" && args.includes("--is-bare-repository")) {
          return Promise.resolve("false\n");
        }
        if (args[0] === "rev-parse" && args[1] === "--verify") {
          return Promise.resolve("abc123\n");
        }
        if (args[0] === "symbolic-ref") {
          return Promise.resolve("refs/remotes/origin/main\n");
        }
        return Promise.resolve("");
      },
    });

    await expect(service.getRepoInfo("/repo")).resolves.toEqual({
      defaultBranch: "main",
      gitCommonDir: "/repo/.git",
      gitDir: "/repo/.git",
      gitRoot: "/repo",
      headOid: "abc123",
      isBare: false,
      isWorktree: false,
    });
  });

  it("getRepoInfo 在 worktree 内:gitDir !== gitCommonDir → isWorktree=true", async () => {
    const service = createGitService({
      execGit: (args) => {
        if (args[0] === "rev-parse" && args.includes("--show-toplevel")) {
          return Promise.resolve(
            "/repo/.worktrees/feature\n/repo/.git/worktrees/feature\n/repo/.git\n"
          );
        }
        if (args[0] === "rev-parse" && args.includes("--is-bare-repository")) {
          return Promise.resolve("false\n");
        }
        if (args[0] === "rev-parse" && args[1] === "--verify") {
          return Promise.resolve("def456\n");
        }
        if (args[0] === "symbolic-ref") {
          return Promise.reject(new Error("no symbolic-ref"));
        }
        return Promise.resolve("");
      },
    });

    await expect(
      service.getRepoInfo("/repo/.worktrees/feature")
    ).resolves.toMatchObject({
      defaultBranch: null,
      isWorktree: true,
    });
  });

  it("getRepoInfo 空仓库(HEAD 不存在):headOid=null", async () => {
    const service = createGitService({
      execGit: (args) => {
        if (args[0] === "rev-parse" && args.includes("--show-toplevel")) {
          return Promise.resolve("/repo\n/repo/.git\n/repo/.git\n");
        }
        if (args[0] === "rev-parse" && args.includes("--is-bare-repository")) {
          return Promise.resolve("false\n");
        }
        if (args[0] === "rev-parse" && args[1] === "--verify") {
          return Promise.reject(new Error("HEAD doesn't exist"));
        }
        return Promise.resolve("");
      },
    });

    const result = await service.getRepoInfo("/repo");

    expect(result.headOid).toBeNull();
  });

  // B: listBranches
  it("listBranches kind:local 只列 refs/heads", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve(
          `${["refs/heads/main", "origin/main", "abc", "*"].join("\0")}\n`
        );
      },
    });

    const branches = await service.listBranches("/repo", { kind: "local" });

    expect(calls[0]).toContain("refs/heads");
    expect(branches).toEqual([
      {
        isCurrent: true,
        kind: "local",
        lastCommit: "abc",
        name: "main",
        upstream: "origin/main",
      },
    ]);
  });

  it("listBranches kind:all 同时列 refs/heads 与 refs/remotes", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve("");
      },
    });

    await service.listBranches("/repo", { kind: "all" });

    expect(calls[0]).toContain("--sort=-committerdate");
    expect(calls[0]).toContain("refs/heads");
    expect(calls[0]).toContain("refs/remotes");
  });

  it("searchBranches 按 LoomDesk 形态返回分支候选和 ahead/behind", async () => {
    const calls: Array<readonly string[]> = [];
    const record = (fields: readonly string[]) => `${fields.join("\x1f")}\x1e`;
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        if (args[0] === "symbolic-ref") {
          return Promise.resolve("refs/remotes/origin/main\n");
        }
        if (args[0] === "rev-list") {
          return Promise.resolve("2\t1\n");
        }
        return Promise.resolve(
          [
            record([
              "refs/remotes/origin/feature/newer",
              "origin/feature/newer",
              "aaa1111",
              " ",
              "remote subject",
              "Remote Author",
              "2026-01-03T00:00:00Z",
              "",
              "",
            ]),
            record([
              "refs/heads/feature/local",
              "feature/local",
              "bbb2222",
              " ",
              "local subject",
              "Local Author",
              "2026-01-02T00:00:00Z",
              "",
              "",
            ]),
            record([
              "refs/heads/main",
              "main",
              "ccc3333",
              " ",
              "main subject",
              "Main Author",
              "2026-01-01T00:00:00Z",
              "origin/main",
              "[ahead 2, behind 1]",
            ]),
            record([
              "refs/remotes/origin/HEAD",
              "origin/HEAD",
              "ccc3333",
              " ",
              "",
              "",
              "",
              "",
              "",
            ]),
            record([
              "refs/heads/topic/current",
              "topic/current",
              "ddd4444",
              "*",
              "current subject",
              "Current Author",
              "2026-01-04T00:00:00Z",
              "",
              "",
            ]),
          ].join("")
        );
      },
    });

    const result = await service.searchBranches("/repo", { limit: 50 });

    expect(calls.some((args) => args.includes("--sort=-committerdate"))).toBe(
      true
    );
    const branchArgs = calls.find(
      (args) => args[0] === "for-each-ref" && args.includes("refs/heads")
    );
    const branchFormat = branchArgs?.find((arg) => arg.startsWith("--format="));
    expect(branchFormat).toContain("\x1f");
    expect(branchFormat).toContain("\x1e");
    expect(branchFormat).not.toContain("%x1f");
    expect(branchFormat).not.toContain("%x1e");
    expect(result.status).toBe("ok");
    expect(result.currentBranch).toBe("topic/current");
    expect(result.items.map((item) => item.id)).toEqual([
      "refs/heads/main",
      "refs/heads/feature/local",
      "refs/remotes/origin/feature/newer",
    ]);
    expect(result.items[0]).toMatchObject({
      aheadFromCurrent: 2,
      authorName: "Main Author",
      behindFromCurrent: 1,
      commit: "ccc3333",
      kind: "local",
      name: "main",
      pinReason: "default",
      refName: "refs/heads/main",
      subject: "main subject",
    });
  });

  it("searchBranches 返回候选分支相对当前 HEAD 的 ahead/behind", async () => {
    const record = (fields: readonly string[]) => `${fields.join("\x1f")}\x1e`;
    const revListCalls: string[][] = [];
    const service = createGitService({
      execGit: (args) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        if (args[0] === "symbolic-ref") {
          return Promise.resolve("");
        }
        if (args[0] === "rev-list") {
          revListCalls.push([...args]);
          return Promise.resolve("3\t2\n");
        }
        return Promise.resolve(
          [
            record([
              "refs/heads/feature/target",
              "feature/target",
              "aaa1111",
              " ",
              "target subject",
              "Author",
              "2026-01-03T00:00:00Z",
              "origin/feature/target",
              "[ahead 9, behind 8]",
            ]),
            record([
              "refs/heads/feature/gone",
              "feature/gone",
              "bbb2222",
              " ",
              "gone subject",
              "Author",
              "2026-01-02T00:00:00Z",
              "origin/feature/gone",
              "[gone]",
            ]),
            record([
              "refs/heads/feature/unpublished",
              "feature/unpublished",
              "ccc3333",
              " ",
              "unpublished subject",
              "Author",
              "2026-01-01T00:00:00Z",
              "",
              "",
            ]),
            record([
              "refs/heads/main",
              "main",
              "ddd4444",
              "*",
              "main subject",
              "Author",
              "2026-01-04T00:00:00Z",
              "origin/main",
              "",
            ]),
          ].join("")
        );
      },
    });

    const result = await service.searchBranches("/repo", { limit: 50 });

    expect(revListCalls).toContainEqual([
      "rev-list",
      "--left-right",
      "--count",
      "refs/heads/feature/target...HEAD",
    ]);
    expect(result.items).toEqual([
      expect.objectContaining({
        aheadFromCurrent: 3,
        behindFromCurrent: 2,
        name: "feature/target",
      }),
      expect.objectContaining({
        aheadFromCurrent: 3,
        behindFromCurrent: 2,
        name: "feature/gone",
      }),
      expect.objectContaining({
        aheadFromCurrent: 3,
        behindFromCurrent: 2,
        name: "feature/unpublished",
      }),
    ]);
  });

  it("searchBranches 合并模式下无可合入内容时只清空 ahead 并保留 behind", async () => {
    const record = (fields: readonly string[]) => `${fields.join("\x1f")}\x1e`;
    const headTree = "a".repeat(40);
    const mergeModeOptions: {
      diffMode: "mergeIntoCurrent";
      limit: number;
    } = { diffMode: "mergeIntoCurrent", limit: 50 };
    const service = createGitService({
      execGit: (args) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        if (args[0] === "symbolic-ref") {
          return Promise.resolve("");
        }
        if (
          args.join(" ") ===
          "rev-list --left-right --count refs/heads/feature/noop...HEAD"
        ) {
          return Promise.resolve("6\t4\n");
        }
        if (args.join(" ") === "rev-parse HEAD^{tree}") {
          return Promise.resolve(`${headTree}\n`);
        }
        if (
          args.join(" ") ===
          "merge-tree --write-tree HEAD refs/heads/feature/noop"
        ) {
          return Promise.resolve(`${headTree}\n`);
        }
        return Promise.resolve(
          [
            record([
              "refs/heads/feature/noop",
              "feature/noop",
              "aaa1111",
              " ",
              "noop merge subject",
              "Author",
              "2026-01-03T00:00:00Z",
              "",
              "",
            ]),
            record([
              "refs/heads/main",
              "main",
              "ddd4444",
              "*",
              "main subject",
              "Author",
              "2026-01-04T00:00:00Z",
              "",
              "",
            ]),
          ].join("")
        );
      },
    });

    const result = await service.searchBranches("/repo", mergeModeOptions);

    expect(result.items).toEqual([
      expect.objectContaining({
        aheadFromCurrent: 0,
        behindFromCurrent: 4,
        name: "feature/noop",
      }),
    ]);
  });

  it("searchBranches 合并模式下有可合入内容时保留提交图 ahead/behind", async () => {
    const record = (fields: readonly string[]) => `${fields.join("\x1f")}\x1e`;
    const headTree = "a".repeat(40);
    const mergeTree = "b".repeat(40);
    const service = createGitService({
      execGit: (args) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        if (args[0] === "symbolic-ref") {
          return Promise.resolve("");
        }
        if (
          args.join(" ") ===
          "rev-list --left-right --count refs/heads/feature/content...HEAD"
        ) {
          return Promise.resolve("6\t4\n");
        }
        if (args.join(" ") === "rev-parse HEAD^{tree}") {
          return Promise.resolve(`${headTree}\n`);
        }
        if (
          args.join(" ") ===
          "merge-tree --write-tree HEAD refs/heads/feature/content"
        ) {
          return Promise.resolve(`${mergeTree}\n`);
        }
        return Promise.resolve(
          [
            record([
              "refs/heads/feature/content",
              "feature/content",
              "aaa1111",
              " ",
              "content merge subject",
              "Author",
              "2026-01-03T00:00:00Z",
              "",
              "",
            ]),
            record([
              "refs/heads/main",
              "main",
              "ddd4444",
              "*",
              "main subject",
              "Author",
              "2026-01-04T00:00:00Z",
              "",
              "",
            ]),
          ].join("")
        );
      },
    });

    const result = await service.searchBranches("/repo", {
      diffMode: "mergeIntoCurrent",
      limit: 50,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        aheadFromCurrent: 6,
        behindFromCurrent: 4,
        name: "feature/content",
      }),
    ]);
  });

  it("searchBranches 合并模式标注候选 tip tree 已在当前历史出现", async () => {
    const record = (fields: readonly string[]) => `${fields.join("\x1f")}\x1e`;
    const headTree = "a".repeat(40);
    const matchedTree = "c".repeat(40);
    const mergeTree = "d".repeat(40);
    const service = createGitService({
      execGit: (args) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        if (args[0] === "symbolic-ref") {
          return Promise.resolve("");
        }
        if (
          args.join(" ") ===
          "rev-list --left-right --count refs/heads/feature/squashed...HEAD"
        ) {
          return Promise.resolve("6\t7\n");
        }
        if (args.join(" ") === "rev-parse HEAD^{tree}") {
          return Promise.resolve(`${headTree}\n`);
        }
        if (
          args.join(" ") ===
          "merge-tree --write-tree HEAD refs/heads/feature/squashed"
        ) {
          return Promise.resolve(`${mergeTree}\n`);
        }
        if (args[0] === "log") {
          return Promise.resolve(
            [
              `${headTree}\x1fd3bb9741\x1fcurrent branch tip`,
              `${"b".repeat(40)}\x1f119250d8\x1flater main work`,
              `${matchedTree}\x1feb9c60a2\x1fsquash merge commit`,
            ].join("\n")
          );
        }
        return Promise.resolve(
          [
            record([
              "refs/heads/feature/squashed",
              "feature/squashed",
              "aaa1111",
              " ",
              "source branch tip",
              "Author",
              "2026-01-03T00:00:00Z",
              "",
              "",
              matchedTree,
            ]),
            record([
              "refs/heads/main",
              "main",
              "ddd4444",
              "*",
              "main subject",
              "Author",
              "2026-01-04T00:00:00Z",
              "",
              "",
              headTree,
            ]),
          ].join("")
        );
      },
    });

    const result = await service.searchBranches("/repo", {
      diffMode: "mergeIntoCurrent",
      limit: 50,
    });
    const item = result.items[0] as (typeof result.items)[number] & {
      tipTreeInCurrentHistory?: {
        commit: string;
        commitsSince: number;
        subject: string | null;
      } | null;
    };

    expect(item).toMatchObject({
      aheadFromCurrent: 6,
      behindFromCurrent: 7,
      name: "feature/squashed",
      tipTreeInCurrentHistory: {
        commit: "eb9c60a2",
        commitsSince: 2,
        subject: "squash merge commit",
      },
    });
  });

  it("searchBranches 支持大 limit 返回 50+ 分支且 ahead/behind 补水有上限", async () => {
    const record = (index: number) =>
      `${[
        `refs/heads/feature/${index}`,
        `feature/${index}`,
        `abc${index}`,
        " ",
        "",
        "",
        "2026-01-01T00:00:00Z",
        "",
        "",
      ].join("\x1f")}\x1e`;
    let revListCalls = 0;
    const service = createGitService({
      execGit: (args) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        if (args[0] === "symbolic-ref") {
          return Promise.resolve("");
        }
        if (args[0] === "rev-list") {
          revListCalls += 1;
          return Promise.resolve("0\t0\n");
        }
        return Promise.resolve(
          Array.from({ length: 120 }, (_item, index) => record(index)).join("")
        );
      },
    });

    const result = await service.searchBranches("/repo", { limit: 1000 });

    expect(result.status).toBe("ok");
    // 超过旧的 50/100 上限的分支也能被返回(命令面板本地过滤需要全量候选)
    expect(result.items).toHaveLength(120);
    // ahead/behind 每项一次 rev-list,必须有界,不能随分支数线性放大阻塞时间。
    expect(revListCalls).toBeLessThanOrEqual(20);
    expect(result.items[0]).toMatchObject({
      aheadFromCurrent: 0,
      behindFromCurrent: 0,
    });
    expect(result.items[119]).toMatchObject({
      aheadFromCurrent: null,
      behindFromCurrent: null,
    });
  });

  it("searchBranches 默认 limit 与错误 currentBranch 返回值对齐 LoomDesk", async () => {
    const record = (index: number) =>
      `${[
        `refs/heads/feature/${index}`,
        `feature/${index}`,
        `abc${index}`,
        " ",
        "",
        "",
        "2026-01-01T00:00:00Z",
        "",
      ].join("\x1f")}\x1e`;
    const service = createGitService({
      execGit: (args) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        if (args[0] === "symbolic-ref") {
          return Promise.resolve("");
        }
        if (args[0] === "rev-list") {
          return Promise.resolve("0\t0\n");
        }
        return Promise.resolve(
          Array.from({ length: 25 }, (_item, index) => record(index)).join("")
        );
      },
    });

    await expect(service.searchBranches("/repo")).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ name: "feature/0" }),
      ]),
      status: "ok",
    });
    const result = await service.searchBranches("/repo");
    expect(result.items).toHaveLength(20);

    const failingService = createGitService({
      execGit: (args) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        throw new GitExecError({
          args,
          cwd: "/repo",
          exitCode: 1,
          message: "git failed",
          stderr: "fatal: boom",
          stdout: "",
        });
      },
    });

    await expect(
      failingService.searchBranches("/repo", { currentBranch: "main" })
    ).resolves.toMatchObject({
      currentBranch: null,
      items: [],
      message: "fatal: boom",
      status: "error",
    });
  });

  // B/C: 三个轻量方法
  it("resolveRef 用 rev-parse --verify 返回 oid", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve("abc123\n");
      },
    });

    await expect(service.resolveRef("/repo", "HEAD")).resolves.toBe("abc123");
    expect(calls[0]).toEqual(["rev-parse", "--verify", "HEAD"]);
  });

  it("show/rev-parse 类 read API 拒绝以 dash 开头的 revision 参数", async () => {
    const service = createGitService({
      execGit: () => Promise.resolve(""),
    });

    await expect(
      service.getCommit("/repo", "--output=/tmp/pwned")
    ).rejects.toThrow('commit oid must not start with "-"');
    await expect(
      service.getCommitPatch("/repo", "--output=/tmp/pwned")
    ).rejects.toThrow('commit oid must not start with "-"');
    expect(() =>
      service.getFileContent("/repo", {
        path: "README.md",
        ref: "--output=/tmp/pwned",
      })
    ).toThrow('file ref must not start with "-"');
    await expect(
      service.resolveRef("/repo", "--output=/tmp/pwned")
    ).rejects.toThrow('ref must not start with "-"');
  });

  it("validateBranchName 合法名返回 true", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve("");
      },
    });

    await expect(
      service.validateBranchName("/repo", "feature/a")
    ).resolves.toBe(true);
    expect(calls[0]).toEqual(["check-ref-format", "--branch", "feature/a"]);
  });

  it("validateBranchName 非法名返回 false(不抛错)", async () => {
    const service = createGitService({
      execGit: () => Promise.reject(new Error("invalid branch")),
    });

    await expect(
      service.validateBranchName("/repo", "bad branch")
    ).resolves.toBe(false);
  });

  it("isWorkingTreeClean 无变更文件返回 true", async () => {
    const service = createGitService({
      execGit: () => Promise.resolve("# branch.head main\0"),
    });

    await expect(service.isWorkingTreeClean("/repo")).resolves.toBe(true);
  });

  it("isWorkingTreeClean 有变更文件返回 false", async () => {
    const service = createGitService({
      execGit: () =>
        Promise.resolve(
          `${[
            "# branch.head main",
            "1 .M N... 100644 100644 100644 a b src/x.ts",
          ].join("\0")}\0`
        ),
    });

    await expect(service.isWorkingTreeClean("/repo")).resolves.toBe(false);
  });

  // D/E: getFileContent, getCommit, getCommitPatch
  it("getFileContent 默认用 HEAD:path", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve("const a = 1;\n");
      },
    });

    await expect(
      service.getFileContent("/repo", { path: "src/a.ts" })
    ).resolves.toBe("const a = 1;\n");
    expect(calls[0]).toEqual(["show", "HEAD:src/a.ts"]);
  });

  it("getFileContent 可指定 ref", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve("");
      },
    });

    await service.getFileContent("/repo", { path: "src/a.ts", ref: "abc123" });
    expect(calls[0]).toEqual(["show", "abc123:src/a.ts"]);
  });

  it("getCommit 用 git log -1 --format=... 返回单条 GitCommit", async () => {
    const service = createGitService({
      execGit: () =>
        Promise.resolve("abc\x1fAlice\x1f2026-06-01\x1ffeat: x\x1e"),
    });

    await expect(service.getCommit("/repo", "abc")).resolves.toEqual({
      author: "Alice",
      date: "2026-06-01",
      hash: "abc",
      message: "feat: x",
    });
  });

  it("getCommitPatch 用 git show --format= 并解析为 GitDiffPatch", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve(
          [
            "diff --git a/x.ts b/x.ts",
            "--- a/x.ts",
            "+++ b/x.ts",
            "@@ -1,1 +1,1 @@",
            "-old",
            "+new",
            "",
          ].join("\n")
        );
      },
    });

    const patch = await service.getCommitPatch("/repo", "abc");
    expect(calls[0]).toContain("show");
    expect(calls[0]).toContain("--no-ext-diff");
    expect(patch.files[0]?.path).toBe("x.ts");
    expect(patch.files[0]?.hunks[0]?.lines).toEqual([
      { kind: "del", text: "old" },
      { kind: "add", text: "new" },
    ]);
  });

  // E: getLog 扩展过滤(author/grep/since/until/path);依 codex 审查不另起 searchCommits
  it("getLog 把 author/grep/since/until 转成对应 --flag", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve("");
      },
    });

    await service.getLog("/repo", {
      author: "Alice",
      grep: "fix",
      since: "2026-01-01",
      until: "2026-06-01",
    });

    const args = calls[0] ?? [];
    expect(args).toContain("--author=Alice");
    expect(args).toContain("--grep=fix");
    expect(args).toContain("--since=2026-01-01");
    expect(args).toContain("--until=2026-06-01");
  });

  it("getLog 的 path 选项追加 -- <path>(限定文件)", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve("");
      },
    });

    await service.getLog("/repo", { path: "src/a.ts" });

    const args = calls[0] ?? [];
    const dashDashIndex = args.indexOf("--");
    expect(dashDashIndex).toBeGreaterThanOrEqual(0);
    expect(args[dashDashIndex + 1]).toBe("src/a.ts");
  });

  // Phase 2-A: 暂存与提交(写)
  it("stage 用 git add -- <paths>", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve("");
      },
    });

    await service.stage("/repo", { paths: ["src/a.ts", "src/b.ts"] });

    expect(calls[0]).toEqual(["add", "--", "src/a.ts", "src/b.ts"]);
  });

  it("stage paths 为空抛错(防误调清空所有)", async () => {
    const service = createGitService({
      execGit: () => Promise.resolve(""),
    });
    await expect(service.stage("/repo", { paths: [] })).rejects.toThrow();
  });

  it("unstage 用 git restore --staged -- <paths>", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve("");
      },
    });

    await service.unstage("/repo", { paths: ["src/a.ts"] });

    expect(calls[0]).toEqual(["restore", "--staged", "--", "src/a.ts"]);
  });

  it("discardChanges 用 git restore -- <paths>(不带 --staged)", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve("");
      },
    });

    await service.discardChanges("/repo", { paths: ["src/a.ts"] });

    expect(calls[0]).toEqual(["restore", "--", "src/a.ts"]);
  });

  it("discardChanges paths 为空抛错(危险操作显式)", async () => {
    const service = createGitService({
      execGit: () => Promise.resolve(""),
    });
    await expect(
      service.discardChanges("/repo", { paths: [] })
    ).rejects.toThrow();
  });

  it("commit 用 git commit -m <message>;signoff/allowEmpty 加对应 flag", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve("[main abc] feat: x\n");
      },
    });

    await service.commit("/repo", {
      allowEmpty: true,
      message: "feat: x",
      signoff: true,
    });

    expect(calls[0]).toContain("commit");
    expect(calls[0]).toContain("-m");
    expect(calls[0]).toContain("feat: x");
    expect(calls[0]).toContain("--signoff");
    expect(calls[0]).toContain("--allow-empty");
  });

  it("写操作传 timeoutMs: 60000(避免大仓库回归)", async () => {
    const seenOptions: Array<{ timeoutMs?: number } | undefined> = [];
    const service = createGitService({
      execGit: (_args, _cwd, options) => {
        seenOptions.push(options);
        return Promise.resolve("");
      },
    });

    await service.stage("/repo", { paths: ["a"] });
    await service.commit("/repo", { message: "m" });

    expect(seenOptions[0]?.timeoutMs).toBe(60_000);
    expect(seenOptions[1]?.timeoutMs).toBe(60_000);
  });

  // Phase 2-B: 分支写操作
  // A1: branch name 不可以 "-" 开头(否则会被 git 当 flag)
  it("createBranch 拒绝 name 以 - 开头", async () => {
    const service = createGitService({
      execGit: () => Promise.resolve(""),
    });
    await expect(
      service.createBranch("/repo", { name: "--evil" })
    ).rejects.toThrow();
  });

  it("deleteBranch 拒绝 name 以 - 开头", async () => {
    const service = createGitService({
      execGit: () => Promise.resolve(""),
    });
    await expect(
      service.deleteBranch("/repo", { name: "--force" })
    ).rejects.toThrow();
  });

  it("checkoutBranch 拒绝 name 以 - 开头", async () => {
    const service = createGitService({
      execGit: () => Promise.resolve(""),
    });
    await expect(service.checkoutBranch("/repo", "--help")).rejects.toThrow();
  });

  it("createBranch 用 git branch <name>(无 startPoint)", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve("");
      },
    });

    await service.createBranch("/repo", { name: "feature/a" });

    expect(calls[0]).toEqual(["branch", "feature/a"]);
  });

  it("createBranch 带 startPoint 时附在末尾", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve("");
      },
    });

    await service.createBranch("/repo", {
      name: "feature/a",
      startPoint: "origin/main",
    });

    expect(calls[0]).toEqual(["branch", "feature/a", "origin/main"]);
  });

  it("deleteBranch 默认 -d;force=true 用 -D", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve("");
      },
    });

    await service.deleteBranch("/repo", { name: "old" });
    await service.deleteBranch("/repo", { force: true, name: "rough" });

    expect(calls[0]).toEqual(["branch", "-d", "old"]);
    expect(calls[1]).toEqual(["branch", "-D", "rough"]);
  });

  it("checkoutBranch 用 git switch <name>(更现代,避免意外创建)", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve("");
      },
    });

    await service.checkoutBranch("/repo", "main");

    expect(calls[0]).toEqual(["switch", "main"]);
  });

  it("merge 非冲突错误按 LoomDesk 返回 unavailable", async () => {
    const service = createGitService({
      execGit: (args, cwd) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        throw new GitExecError({
          args,
          cwd,
          exitCode: 1,
          message: "git 退出码 1: bad ref",
          stderr: "merge: missing-branch - not something we can merge",
          stdout: "",
        });
      },
    });

    await expect(service.merge("/repo", "missing-branch")).resolves.toEqual({
      kind: "unavailable",
      message: "merge: missing-branch - not something we can merge",
    });
  });

  it("merge 默认走裸 merge：允许 ff、不注入 --no-ff / --no-verify", async () => {
    const calls: Array<readonly string[]> = [];
    const headTree = "a".repeat(40);
    const mergeTree = "b".repeat(40);
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        if (args.join(" ") === "rev-parse HEAD^{tree}") {
          return Promise.resolve(`${headTree}\n`);
        }
        if (args.join(" ") === "merge-tree --write-tree HEAD main") {
          return Promise.resolve(`${mergeTree}\n`);
        }
        return Promise.resolve("Updating abc..def\nFast-forward\n");
      },
    });

    await expect(service.merge("/repo", "main")).resolves.toEqual({
      kind: "ok",
      message: "Updating abc..def\nFast-forward",
    });
    // 允许只读 no-op 预检；实际 merge 仍保持 VS Code 同口径的裸 merge。
    expect(calls).toEqual([
      ["rev-parse", "--show-toplevel"],
      ["rev-parse", "HEAD^{tree}"],
      ["merge-tree", "--write-tree", "HEAD", "main"],
      ["merge", "--no-edit", "--", "main"],
    ]);
  });

  it("merge 在合入树等于 HEAD 树时返回 already_up_to_date 且不创建空合并提交", async () => {
    const calls: Array<readonly string[]> = [];
    const headTree = "a".repeat(40);
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        if (args.join(" ") === "rev-parse HEAD^{tree}") {
          return Promise.resolve(`${headTree}\n`);
        }
        if (
          args.join(" ") ===
          "merge-tree --write-tree HEAD feature/plugin-groundwork"
        ) {
          return Promise.resolve(`${headTree}\n`);
        }
        return Promise.resolve("Merge made by the 'ort' strategy.\n");
      },
    });

    await expect(
      service.merge("/repo", "feature/plugin-groundwork")
    ).resolves.toEqual({ kind: "already_up_to_date" });
    expect(calls).not.toContainEqual([
      "merge",
      "--no-edit",
      "--",
      "feature/plugin-groundwork",
    ]);
  });

  it("merge 冲突时按未合并文件数返回 conflict", async () => {
    const service = createGitService({
      execGit: (args, cwd) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        // countConflicts 的固定参数形态：对不上就落入下方 throw，
        // 计数退化为 stderr 兜底的 1，断言会红
        if (args.join(" ") === "diff --name-only --diff-filter=U") {
          return Promise.resolve("src/a.ts\nsrc/b.ts\n");
        }
        throw new GitExecError({
          args,
          cwd,
          exitCode: 1,
          message: "git 退出码 1: merge conflict",
          stderr:
            "CONFLICT (content): Merge conflict in src/a.ts\nAutomatic merge failed; fix conflicts and then commit the result.",
          stdout: "",
        });
      },
    });

    await expect(service.merge("/repo", "feature/x")).resolves.toEqual({
      conflictCount: 2,
      kind: "conflict",
    });
  });

  it("listStashes 按 LoomDesk 返回 ok entries 包装", async () => {
    const service = createGitService({
      execGit: (args) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        return Promise.resolve(
          "stash@{0}\u001fWIP on main\u001f2026-01-01T00:00:00Z\u001fabc123\n"
        );
      },
    });

    await expect(service.listStashes("/repo")).resolves.toEqual({
      entries: [
        {
          date: "2026-01-01T00:00:00Z",
          hash: "abc123",
          index: 0,
          message: "WIP on main",
        },
      ],
      kind: "ok",
    });
  });

  it("stashPop 非冲突错误按 LoomDesk 返回 unavailable", async () => {
    const service = createGitService({
      execGit: (args, cwd) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        throw new GitExecError({
          args,
          cwd,
          exitCode: 1,
          message: "git 退出码 1: bad stash",
          stderr: "fatal: log for 'stash' only has 0 entries",
          stdout: "",
        });
      },
    });

    await expect(service.popStash("/repo", 0)).resolves.toEqual({
      kind: "unavailable",
      message: "fatal: log for 'stash' only has 0 entries",
    });
  });

  it("stashPop 已有未合并文件时非冲突失败不误报 conflict", async () => {
    const service = createGitService({
      execGit: (args, cwd) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        if (args[0] === "diff") {
          // pop 前后未合并文件数不变（既有 merge 冲突残留）
          return Promise.resolve("src/pre-existing.ts\n");
        }
        throw new GitExecError({
          args,
          cwd,
          exitCode: 1,
          message: "git 退出码 1: dirty tree",
          stderr:
            "error: Your local changes to the following files would be overwritten by merge:",
          stdout: "",
        });
      },
    });

    await expect(service.popStash("/repo", 0)).resolves.toEqual({
      kind: "unavailable",
      message:
        "error: Your local changes to the following files would be overwritten by merge:",
    });
  });

  it("stashPop 失败后新增未合并文件仍判定为 conflict", async () => {
    let popAttempted = false;
    const service = createGitService({
      execGit: (args, cwd) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        if (args[0] === "diff") {
          return Promise.resolve(popAttempted ? "src/conflict.ts\n" : "");
        }
        popAttempted = true;
        throw new GitExecError({
          args,
          cwd,
          exitCode: 1,
          message: "git 退出码 1: pop failed",
          stderr: "error: could not restore untracked files from stash",
          stdout: "",
        });
      },
    });

    await expect(service.popStash("/repo", 0)).resolves.toEqual({
      kind: "conflict",
    });
  });

  it("applyStash 不带 index 时 argv 为裸 stash apply", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        return Promise.resolve("");
      },
    });

    await expect(service.applyStash("/repo")).resolves.toEqual({ kind: "ok" });
    // resolve root + 冲突基线 + apply,顺序固定:防止回归丢掉基线抵扣或注入多余参数
    expect(calls).toEqual([
      ["rev-parse", "--show-toplevel"],
      ["diff", "--name-only", "--diff-filter=U"],
      ["stash", "apply"],
    ]);
  });

  it("applyStash 带 index 时追加 stash@{2}", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        return Promise.resolve("");
      },
    });

    await expect(service.applyStash("/repo", 2)).resolves.toEqual({
      kind: "ok",
    });
    expect(calls).toEqual([
      ["rev-parse", "--show-toplevel"],
      ["diff", "--name-only", "--diff-filter=U"],
      ["stash", "apply", "stash@{2}"],
    ]);
  });

  it("applyStash 失败后新增未合并文件判定为 conflict", async () => {
    let applyAttempted = false;
    const service = createGitService({
      execGit: (args, cwd) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        if (args[0] === "diff") {
          // stderr 不含 CONFLICT 字样:只能靠操作前后未合并文件增量判定
          return Promise.resolve(applyAttempted ? "src/conflict.ts\n" : "");
        }
        applyAttempted = true;
        throw new GitExecError({
          args,
          cwd,
          exitCode: 1,
          message: "git 退出码 1: apply failed",
          stderr: "error: could not restore untracked files from stash",
          stdout: "",
        });
      },
    });

    await expect(service.applyStash("/repo", 0)).resolves.toEqual({
      kind: "conflict",
    });
  });

  it("dropStash 带 index 时 argv 为 stash drop stash@{1} 且无冲突基线调用", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        return Promise.resolve("Dropped stash@{1}\n");
      },
    });

    await expect(service.dropStash("/repo", 1)).resolves.toEqual({
      kind: "ok",
    });
    expect(calls).toEqual([
      ["rev-parse", "--show-toplevel"],
      ["stash", "drop", "stash@{1}"],
    ]);
  });

  it("dropStash 失败按 LoomDesk 返回 unavailable 带 stderr", async () => {
    const service = createGitService({
      execGit: (args, cwd) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        throw new GitExecError({
          args,
          cwd,
          exitCode: 1,
          message: "git 退出码 1: bad ref",
          stderr: "error: stash@{9} is not a valid reference",
          stdout: "",
        });
      },
    });

    await expect(service.dropStash("/repo", 9)).resolves.toEqual({
      kind: "unavailable",
      message: "error: stash@{9} is not a valid reference",
    });
  });

  it("stash 缺省与 includeUntracked: false 都不追加 --include-untracked", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        return Promise.resolve("Saved working directory\n");
      },
    });

    await expect(service.stash("/repo", {})).resolves.toEqual({ kind: "ok" });
    await expect(
      service.stash("/repo", { includeUntracked: false })
    ).resolves.toEqual({ kind: "ok" });
    expect(calls.filter((args) => args[0] === "stash")).toEqual([
      ["stash", "push"],
      ["stash", "push"],
    ]);
  });

  it("stash includeUntracked: true 时追加 --include-untracked", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        return Promise.resolve("Saved working directory\n");
      },
    });

    await expect(
      service.stash("/repo", { includeUntracked: true })
    ).resolves.toEqual({ kind: "ok" });
    expect(calls).toEqual([
      ["rev-parse", "--show-toplevel"],
      ["stash", "push", "--include-untracked"],
    ]);
  });

  it("rebase 冲突按 LoomDesk 返回 conflict 而不是抛出", async () => {
    const service = createGitService({
      execGit: (args, cwd) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        if (args[0] === "diff") {
          return Promise.resolve("src/conflict.ts\n");
        }
        throw new GitExecError({
          args,
          cwd,
          exitCode: 1,
          message: "git 退出码 1: conflict",
          stderr: "CONFLICT (content): Merge conflict in src/conflict.ts",
          stdout: "",
        });
      },
    });

    await expect(service.rebase("/repo", "main")).resolves.toEqual({
      kind: "conflict",
      message: "CONFLICT (content): Merge conflict in src/conflict.ts",
    });
  });

  it("rebase 使用 stdout+stderr 判定 already_up_to_date", async () => {
    const seenOptions: Array<
      | {
          onSuccessStderr?: (stderr: string) => void;
          timeoutMs?: number;
        }
      | undefined
    > = [];
    const service = createGitService({
      execGit: (args, _cwd, options) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        seenOptions.push(options);
        options?.onSuccessStderr?.("Current branch feature is up to date.\n");
        return Promise.resolve("");
      },
    });

    await expect(service.rebase("/repo", "main")).resolves.toEqual({
      kind: "already_up_to_date",
    });
    expect(seenOptions[0]).toMatchObject({
      timeoutMs: 60_000,
    });
    expect(seenOptions[0]?.onSuccessStderr).toEqual(expect.any(Function));
  });

  it("rebase ok message 只返回 stdout,stderr 仅用于判定", async () => {
    const service = createGitService({
      execGit: (args, _cwd, options) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        options?.onSuccessStderr?.("Successfully rebased and updated refs.\n");
        return Promise.resolve("Rebased local commits\n");
      },
    });

    await expect(service.rebase("/repo", "main")).resolves.toEqual({
      kind: "ok",
      message: "Rebased local commits",
    });
  });

  it("rebaseContinue 使用 GIT_EDITOR=true 并返回 unavailable 而不是抛出", async () => {
    const seenOptions: Array<
      { env?: Readonly<Record<string, string>>; timeoutMs?: number } | undefined
    > = [];
    const service = createGitService({
      execGit: (args, cwd, options) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        seenOptions.push(options);
        throw new GitExecError({
          args,
          cwd,
          exitCode: 1,
          message: "git 退出码 1: no rebase in progress",
          stderr: "fatal: No rebase in progress?",
          stdout: "",
        });
      },
    });

    await expect(service.continueRebase("/repo")).resolves.toEqual({
      kind: "unavailable",
      message: "fatal: No rebase in progress?",
    });
    expect(seenOptions[0]).toMatchObject({
      env: { GIT_EDITOR: "true" },
      timeoutMs: 60_000,
    });
  });

  it("undoLastCommit 在非 Git 仓库按 LoomDesk 返回 unavailable", async () => {
    const service = createGitService({
      execGit: (args, cwd) => {
        throw new GitExecError({
          args,
          cwd,
          exitCode: 128,
          message: "git 退出码 128: not a git repository",
          stderr:
            "fatal: not a git repository (or any of the parent directories): .git",
          stdout: "",
        });
      },
    });

    await expect(service.undoLastCommit("/tmp")).resolves.toEqual({
      kind: "unavailable",
      message: "Invalid git repository",
    });
  });

  it("undoLastCommit 在空仓库 HEAD 不存在时返回 nothing_to_undo", async () => {
    const service = createGitService({
      execGit: (args, cwd) => {
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        throw new GitExecError({
          args,
          cwd,
          exitCode: 128,
          message: "git 退出码 128: ambiguous HEAD",
          stderr:
            "fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.",
          stdout: "",
        });
      },
    });

    await expect(service.undoLastCommit("/repo")).resolves.toEqual({
      kind: "nothing_to_undo",
    });
  });

  it("push 使用受控 git push 并返回 ok", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        return Promise.resolve("");
      },
    });

    await expect(service.push("/repo")).resolves.toEqual({ kind: "ok" });
    expect(calls).toEqual([["rev-parse", "--show-toplevel"], ["push"]]);
  });

  it("pullFastForward 使用 --ff-only 避免隐式 merge", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        return Promise.resolve("");
      },
    });

    await expect(service.pullFastForward("/repo")).resolves.toEqual({
      kind: "ok",
    });
    expect(calls).toEqual([
      ["rev-parse", "--show-toplevel"],
      ["pull", "--ff-only"],
    ]);
  });

  it("sync 先 rebase 拉取再推送", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        return Promise.resolve("");
      },
    });

    await expect(service.sync("/repo")).resolves.toEqual({ kind: "ok" });
    expect(calls).toEqual([
      ["rev-parse", "--show-toplevel"],
      ["pull", "--rebase"],
      ["push"],
    ]);
  });

  it("sync 在 rebase 拉取失败时不推送", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args, cwd) => {
        calls.push(args);
        if (isGitRootRequest(args)) {
          return Promise.resolve("/repo\n");
        }
        if (args[0] === "pull") {
          throw new GitExecError({
            args,
            cwd,
            exitCode: 128,
            message: "git 退出码 128: rebase failed",
            stderr: "fatal: rebase failed",
            stdout: "",
          });
        }
        return Promise.resolve("");
      },
    });

    await expect(service.sync("/repo")).resolves.toEqual({
      kind: "unavailable",
      message: "fatal: rebase failed",
    });
    expect(calls).toEqual([
      ["rev-parse", "--show-toplevel"],
      ["pull", "--rebase"],
    ]);
  });

  it("listTags 返回标签名数组", async () => {
    const service = createGitService({
      execGit: () => Promise.resolve("v1.0.0\nv1.0.1\nv2.0.0\n"),
    });

    await expect(service.listTags("/repo")).resolves.toEqual([
      "v1.0.0",
      "v1.0.1",
      "v2.0.0",
    ]);
  });

  it("getLog 带 --max-count 并解析记录", async () => {
    const calls: Array<readonly string[]> = [];
    const service = createGitService({
      execGit: (args) => {
        calls.push(args);
        return Promise.resolve(
          `${["abc\x1fAlice\x1f2026-06-01\x1ffeat"].join("\x1e")}\x1e`
        );
      },
    });

    const log = await service.getLog("/repo", { maxCount: 5 });

    expect(calls[0]?.[0]).toBe("log");
    expect(calls[0]).toContain("--max-count=5");
    expect(log).toEqual([
      { author: "Alice", date: "2026-06-01", hash: "abc", message: "feat" },
    ]);
  });
});
