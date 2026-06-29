import {
  parseGitBranchRefs,
  parseGitLog,
  parseGitNumstat,
  parseGitStatus,
  parseUnifiedDiff,
} from "@main/services/git-parsers.ts";
import { createGitService } from "@main/services/git-service.ts";
import { describe, expect, it } from "vitest";

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
      upstream: null,
    });
  });

  it("detached HEAD 时 branch 为 null", () => {
    const output = "# branch.head (detached)\0";

    expect(parseGitStatus(output).branch.branch).toBeNull();
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
  it("getStatus 用 porcelain=v2 --branch -z 并解析结果", async () => {
    const calls: Array<{ args: readonly string[]; cwd: string }> = [];
    const service = createGitService({
      execGit: (args, cwd) => {
        calls.push({ args, cwd });
        return Promise.resolve(
          `${[
            "# branch.head main",
            "1 .M N... 100644 100644 100644 a b src/foo.ts",
          ].join("\0")}\0`
        );
      },
    });

    const status = await service.getStatus("/repo");

    expect(calls).toEqual([
      { args: ["status", "--porcelain=v2", "--branch", "-z"], cwd: "/repo" },
    ]);
    expect(status.branch.branch).toBe("main");
    expect(status.files).toHaveLength(1);
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

    expect(calls[0]).toContain("refs/heads");
    expect(calls[0]).toContain("refs/remotes");
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
