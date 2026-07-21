import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExecGitRaw,
  execGit,
  execGitRaw,
} from "@main/services/git-exec.ts";
import { GitReviewBudget } from "@main/services/git-review/git-review-budget.ts";
import { GitReviewIdentityResolver } from "@main/services/git-review/git-review-identity.ts";
import { GitReviewIndexReader } from "@main/services/git-review/git-review-index.ts";
import type {
  GitReviewFileDocumentRequest,
  GitReviewFileDocumentResult,
  GitReviewFileSource,
} from "@shared/contracts/git-review.ts";
import { afterEach, describe, expect, it } from "vitest";
import { TestGitReviewService as GitReviewService } from "./git-review-test-fixtures.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pier-review-document-"));
  roots.push(root);
  await execGit(["init"], { cwd: root });
  await execGit(["config", "user.name", "Pier Test"], { cwd: root });
  await execGit(["config", "user.email", "pier@example.invalid"], {
    cwd: root,
  });
  return root;
}

async function commitAll(root: string, message: string): Promise<string> {
  await execGit(["add", "-A", "--"], { cwd: root });
  await execGit(["commit", "-m", message], { cwd: root });
  return (await execGit(["rev-parse", "HEAD"], { cwd: root })).trim();
}

function request(source: GitReviewFileSource): GitReviewFileDocumentRequest {
  return {
    operationId: randomUUID(),
    source,
  };
}

function source(
  root: string,
  path: string,
  oldPaths: readonly string[] = []
): GitReviewFileSource {
  return {
    contextId: "worktree:test",
    gitRootPath: root,
    oldPaths: [...oldPaths],
    path,
    target: { kind: "uncommitted" },
  };
}

function expectOk(
  result: GitReviewFileDocumentResult
): asserts result is Extract<GitReviewFileDocumentResult, { kind: "ok" }> {
  expect(result.kind).toBe("ok");
}

describe("GitReviewService document", () => {
  it("以未暂存→已暂存顺序返回两个 patch section", async () => {
    const root = await createRepository();
    await writeFile(join(root, "file.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await writeFile(join(root, "file.ts"), "staged\n", "utf8");
    await execGit(["add", "--", "file.ts"], { cwd: root });
    await writeFile(join(root, "file.ts"), "staged\nworktree\n", "utf8");
    const service = new GitReviewService();
    const documentSource = source(root, "file.ts");

    const result = await service.getFileDocument(request(documentSource));

    expectOk(result);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sections)).toBe(true);
    expect(Object.isFrozen(result.sections[0])).toBe(true);
    expect(result.sections).toHaveLength(2);
    expect(result.sections.map((section) => section.kind)).toEqual([
      "patch",
      "patch",
    ]);
    const [unstaged, staged] = result.sections;
    expect(unstaged?.kind === "patch" && unstaged.patch).toContain("+worktree");
    expect(staged?.kind === "patch" && staged.patch).toContain("+staged");
  });

  it("commit 目标返回该提交的 committed patch section", async () => {
    const root = await createRepository();
    await writeFile(join(root, "file.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await writeFile(join(root, "file.ts"), "committed\n", "utf8");
    const commit = await commitAll(root, "change");
    // 工作区后续变化不影响 commit 目标的 patch
    await writeFile(join(root, "file.ts"), "dirty\n", "utf8");

    const result = await new GitReviewService().getFileDocument(
      request({
        ...source(root, "file.ts"),
        target: { kind: "commit", oid: commit },
      })
    );

    expectOk(result);
    expect(result.sections).toHaveLength(1);
    const [committed] = result.sections;
    expect(committed?.kind === "patch" && committed.patch).toContain(
      "+committed"
    );
    expect(committed?.kind === "patch" && committed.patch).not.toContain(
      "+dirty"
    );
  });

  it("branch 目标返回 merge-base..HEAD 的 committed patch section", async () => {
    const root = await createRepository();
    await writeFile(join(root, "shared.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await execGit(["branch", "main-line"], { cwd: root });
    await execGit(["switch", "-c", "feature"], { cwd: root });
    await writeFile(join(root, "shared.ts"), "base\nfeature\n", "utf8");
    await commitAll(root, "feature work");

    const result = await new GitReviewService().getFileDocument(
      request({
        ...source(root, "shared.ts"),
        target: { kind: "branch", ref: "main-line" },
      })
    );

    expectOk(result);
    expect(result.sections).toHaveLength(1);
    const [committed] = result.sections;
    expect(committed?.kind === "patch" && committed.patch).toContain(
      "+feature"
    );
  });

  it("链式 a→b→c 为每个 group 使用自己的 old/target path", async () => {
    const root = await createRepository();
    await writeFile(join(root, "a.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await execGit(["mv", "a.ts", "b.ts"], { cwd: root });
    await rename(join(root, "b.ts"), join(root, "c.ts"));
    await execGit(["add", "-N", "--", "c.ts"], { cwd: root });

    const result = await new GitReviewService().getFileDocument(
      request(source(root, "c.ts", ["a.ts", "b.ts"]))
    );

    expectOk(result);
    const [unstaged, staged] = result.sections;
    expect(unstaged?.kind === "patch" && unstaged.patch).toContain(
      "diff --git a/b.ts b/c.ts"
    );
    expect(staged?.kind === "patch" && staged.patch).toContain(
      "diff --git a/a.ts b/b.ts"
    );
  });

  it("副本源在同一范围修改时只返回副本条目 patch", async () => {
    const root = await createRepository();
    await writeFile(join(root, "source.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await copyFile(join(root, "source.ts"), join(root, "copy.ts"));
    await writeFile(join(root, "source.ts"), "base\nsource changed\n", "utf8");
    await execGit(["add", "-A", "--"], { cwd: root });

    const result = await new GitReviewService().getFileDocument(
      request(source(root, "copy.ts", ["source.ts"]))
    );

    expectOk(result);
    expect(result.sections).toEqual([
      expect.objectContaining({ kind: "patch" }),
    ]);
    const section = result.sections[0];
    expect(section?.kind).toBe("patch");
    if (section?.kind === "patch") {
      expect(section.patch.match(/^diff --git /gmu)).toHaveLength(1);
      expect(section.patch).not.toContain("+source changed");
    }
  });

  it("副本源产生超预算无关 patch 时在 Git 层只传输目标 section", async () => {
    const root = await createRepository();
    await writeFile(join(root, "source.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await copyFile(join(root, "source.ts"), join(root, "copy.ts"));
    await writeFile(
      join(root, "source.ts"),
      `${"x".repeat(2 * 1024 * 1024)}\n`,
      "utf8"
    );
    await execGit(["add", "-A", "--"], { cwd: root });

    const result = await new GitReviewService().getFileDocument(
      request(source(root, "copy.ts", ["source.ts"])),
      { budget: new GitReviewBudget({ maxOutputBytes: 1024 * 1024 }) }
    );

    expectOk(result);
    const section = result.sections[0];
    expect(section?.kind).toBe("patch");
    if (section?.kind === "patch") {
      expect(section.patch.match(/^diff --git /gmu)).toHaveLength(1);
      expect(section.patch).toContain("copy from source.ts");
    }
  });

  it("在 POSIX 上把反斜杠当作 Git 路径字面字符", async (ctx) => {
    if (process.platform === "win32") {
      ctx.skip();
      return;
    }
    const root = await createRepository();
    const paths = ["\\notes.txt", "dir\\..\\file", "界*?[]\\\t\n.txt"];
    for (const path of paths) {
      await writeFile(join(root, path), "base\n", "utf8");
    }
    await commitAll(root, "base");
    for (const path of paths) {
      await writeFile(join(root, path), "changed\n", "utf8");
    }

    const service = new GitReviewService();
    for (const path of paths) {
      const result = await service.getFileDocument(request(source(root, path)));
      expectOk(result);
      expect(result.sections).toEqual([
        expect.objectContaining({ kind: "patch" }),
      ]);
    }
  });

  it("document 索引与正文探测共用输出字节预算", async () => {
    const root = await createRepository();
    await writeFile(join(root, "file.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await writeFile(join(root, "file.ts"), "changed\n", "utf8");
    const budget = new GitReviewBudget({ maxOutputBytes: 1 });

    const result = await new GitReviewService().getFileDocument(
      request(source(root, "file.ts")),
      { budget }
    );

    expect(result).toMatchObject({ kind: "error", reason: "outputLimit" });
  });

  it("文件与目录同名时精确探测不会遍历目录后代", async () => {
    const root = await createRepository();
    await writeFile(join(root, "a"), "base\n", "utf8");
    await commitAll(root, "base");
    await rm(join(root, "a"));
    await execGit(["add", "-u", "--", "a"], { cwd: root });
    await mkdir(join(root, "a"));
    await Promise.all(
      Array.from({ length: 1000 }, (_, index) =>
        writeFile(join(root, "a", `${index}.txt`), `${index}\n`, "utf8")
      )
    );

    const result = await new GitReviewService().getFileDocument(
      request(source(root, "a"))
    );

    expectOk(result);
    expect(result.sections).toEqual([
      expect.objectContaining({ kind: "patch" }),
    ]);
  });

  it("祖先路径 rename 保留单一事实且不纳入后代噪声", async () => {
    const root = await createRepository();
    await writeFile(join(root, "a"), "base\n", "utf8");
    await commitAll(root, "base");
    await rm(join(root, "a"));
    await mkdir(join(root, "a"));
    await writeFile(join(root, "a", "b"), "base\n", "utf8");
    await Promise.all(
      Array.from({ length: 1000 }, (_, index) =>
        writeFile(join(root, "a", `noise-${index}.txt`), `${index}\n`, "utf8")
      )
    );
    await execGit(["add", "-A", "--"], { cwd: root });

    const result = await new GitReviewService().getFileDocument(
      request(source(root, "a/b", ["a"]))
    );

    expectOk(result);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({ kind: "patch" });
    if (result.sections[0]?.kind === "patch") {
      expect(result.sections[0].patch).toContain("rename from a");
      expect(result.sections[0].patch).toContain("rename to a/b");
      expect(result.sections[0].patch).not.toContain("noise-");
    }
  });

  it("同目录分量前缀冲突时使用有界 movement 兜底", async () => {
    const root = await createRepository();
    await writeFile(join(root, "a"), "base\n", "utf8");
    await commitAll(root, "base");
    await rename(join(root, "a"), join(root, "ab"));
    await mkdir(join(root, "a"));
    await Promise.all(
      Array.from({ length: 1000 }, (_, index) =>
        writeFile(join(root, "a", `noise-${index}.txt`), `${index}\n`, "utf8")
      )
    );
    await execGit(["add", "-A", "--"], { cwd: root });

    const result = await new GitReviewService().getFileDocument(
      request(source(root, "ab", ["a"]))
    );

    expectOk(result);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({ kind: "patch" });
    if (result.sections[0]?.kind === "patch") {
      expect(result.sections[0].patch).toContain("rename from a");
      expect(result.sections[0].patch).toContain("rename to ab");
      expect(result.sections[0].patch).not.toContain("noise-");
    }
  });

  it("untracked patch 只写临时 index/ODB，真实仓库保持不变", async () => {
    const root = await createRepository();
    await writeFile(join(root, "tracked.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    const path = ":(glob)-untracked\tfile\n.ts";
    await writeFile(join(root, path), "new\n", "utf8");
    await chmod(join(root, path), 0o755);
    const indexBefore = await execGit(["ls-files", "--stage", "-z"], {
      cwd: root,
    });
    const objectsBefore = await execGit(["count-objects", "-v"], {
      cwd: root,
    });

    const result = await new GitReviewService().getFileDocument(
      request(source(root, path))
    );

    expectOk(result);
    expect(result.sections).toEqual([
      expect.objectContaining({
        kind: "patch",
      }),
    ]);
    expect(
      result.sections[0]?.kind === "patch" && result.sections[0].patch
    ).toContain("new file mode 100755");
    expect(await execGit(["ls-files", "--stage", "-z"], { cwd: root })).toBe(
      indexBefore
    );
    expect(await execGit(["count-objects", "-v"], { cwd: root })).toBe(
      objectsBefore
    );
  });

  it("显式 git dir 末尾 CR 作为路径字节保留", async (ctx) => {
    if (process.platform === "win32") {
      ctx.skip();
      return;
    }
    const parent = await mkdtemp(join(tmpdir(), "pier-review-separate-git-"));
    roots.push(parent);
    const root = join(parent, "worktree");
    const gitDirectory = join(parent, "metadata\r");
    await mkdir(root);
    await execGit(["init", "--bare", gitDirectory], { cwd: parent });
    const repositoryEnv = {
      GIT_DIR: gitDirectory,
      GIT_WORK_TREE: root,
    };
    await execGit(["config", "core.bare", "false"], {
      cwd: root,
      env: repositoryEnv,
    });
    await execGit(["config", "user.name", "Pier Test"], {
      cwd: root,
      env: repositoryEnv,
    });
    await execGit(["config", "user.email", "pier@example.invalid"], {
      cwd: root,
      env: repositoryEnv,
    });
    await writeFile(join(root, "tracked.ts"), "base\n", "utf8");
    await execGit(["add", "-A", "--"], { cwd: root, env: repositoryEnv });
    await execGit(["commit", "-m", "base"], {
      cwd: root,
      env: repositoryEnv,
    });
    await writeFile(join(root, "untracked.ts"), "new\n", "utf8");
    const wrappedExec: ExecGitRaw = (args, options) =>
      execGitRaw(args, {
        ...options,
        env: { ...repositoryEnv, ...options.env },
      });
    const indexReader = new GitReviewIndexReader({
      execGitRaw: wrappedExec,
      identityResolver: new GitReviewIdentityResolver({
        execGitRaw: wrappedExec,
      }),
    });

    const result = await new GitReviewService({
      execGitRaw: wrappedExec,
      indexReader,
    }).getFileDocument(request(source(root, "untracked.ts")));

    expectOk(result);
    expect(result.sections).toEqual([
      expect.objectContaining({ kind: "patch" }),
    ]);
  });

  it("二进制与非法 UTF-8 untracked 文件返回类型化 state", async () => {
    const root = await createRepository();
    await writeFile(join(root, "base.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await writeFile(join(root, "binary.dat"), Buffer.from([0, 1, 2]));
    await writeFile(join(root, "invalid.txt"), Buffer.from([0xc3, 0x28]));
    await writeFile(join(root, "mixed.dat"), Buffer.from([0, 0xff]));
    const service = new GitReviewService();

    const binary = await service.getFileDocument(
      request(source(root, "binary.dat"))
    );
    const invalid = await service.getFileDocument(
      request(source(root, "invalid.txt"))
    );
    const mixedUntracked = await service.getFileDocument(
      request(source(root, "mixed.dat"))
    );
    await execGit(["add", "--", "mixed.dat"], { cwd: root });
    const mixedStaged = await service.getFileDocument(
      request(source(root, "mixed.dat"))
    );

    expectOk(binary);
    expectOk(invalid);
    expect(binary.sections).toEqual([
      expect.objectContaining({
        kind: "state",
        oldPath: null,
        reason: "binary",
        status: "added",
        targetPath: "binary.dat",
      }),
    ]);
    expect(invalid.sections).toEqual([
      expect.objectContaining({ kind: "state", reason: "invalidEncoding" }),
    ]);
    expectOk(mixedUntracked);
    expectOk(mixedStaged);
    expect(mixedUntracked.sections).toEqual([
      expect.objectContaining({ kind: "state", reason: "binary" }),
    ]);
    expect(mixedStaged.sections).toEqual([
      expect.objectContaining({ kind: "state", reason: "binary" }),
    ]);
  });

  it("二进制 staged rename 与 unstaged modify 保留各 section 事实", async () => {
    const root = await createRepository();
    const base = Buffer.alloc(100);
    await writeFile(join(root, "old.dat"), base);
    await commitAll(root, "base");
    await rename(join(root, "old.dat"), join(root, "current.dat"));
    const staged = Buffer.from(base);
    staged[99] = 1;
    await writeFile(join(root, "current.dat"), staged);
    await execGit(["add", "-A", "--"], { cwd: root });
    const worktree = Buffer.from(staged);
    worktree[99] = 2;
    await writeFile(join(root, "current.dat"), worktree);

    const result = await new GitReviewService().getFileDocument(
      request(source(root, "current.dat", ["old.dat"]))
    );

    expectOk(result);
    expect(result.sections).toEqual([
      expect.objectContaining({
        kind: "state",
        oldPath: null,
        reason: "binary",
        status: "modified",
      }),
      expect.objectContaining({
        kind: "state",
        oldPath: "old.dat",
        reason: "binary",
        status: "renamed",
      }),
    ]);
  });

  it("二进制链式重命名保留各 section 的目标路径", async () => {
    const root = await createRepository();
    const base = Buffer.alloc(100);
    await writeFile(join(root, "a.dat"), base);
    await commitAll(root, "base");
    await rename(join(root, "a.dat"), join(root, "b.dat"));
    const staged = Buffer.from(base);
    staged[99] = 1;
    await writeFile(join(root, "b.dat"), staged);
    await execGit(["add", "-A", "--"], { cwd: root });
    await rename(join(root, "b.dat"), join(root, "c.dat"));
    const worktree = Buffer.from(staged);
    worktree[99] = 2;
    await writeFile(join(root, "c.dat"), worktree);
    await execGit(["add", "-N", "--", "c.dat"], { cwd: root });

    const result = await new GitReviewService().getFileDocument(
      request(source(root, "c.dat", ["a.dat", "b.dat"]))
    );

    expectOk(result);
    expect(result.sections).toEqual([
      expect.objectContaining({
        kind: "state",
        oldPath: "b.dat",
        reason: "binary",
        status: "renamed",
        targetPath: "c.dat",
      }),
      expect.objectContaining({
        kind: "state",
        oldPath: "a.dat",
        reason: "binary",
        status: "renamed",
        targetPath: "b.dat",
      }),
    ]);
  });

  it("deleted 文件返回 patch", async () => {
    const root = await createRepository();
    await writeFile(join(root, "deleted.ts"), "deleted\n", "utf8");
    await commitAll(root, "base");
    await rm(join(root, "deleted.ts"));
    const service = new GitReviewService();
    const deleted = await service.getFileDocument(
      request(source(root, "deleted.ts"))
    );

    expectOk(deleted);
    expect(deleted.sections).toEqual([
      expect.objectContaining({ kind: "patch" }),
    ]);
  });

  it("symlink 返回类型化 state", async () => {
    const root = await createRepository();
    await writeFile(join(root, "link.ts"), "regular\n", "utf8");
    await commitAll(root, "base");
    await rm(join(root, "link.ts"));
    await symlink("target.ts", join(root, "link.ts"));
    const service = new GitReviewService();
    const link = await service.getFileDocument(
      request(source(root, "link.ts"))
    );

    expectOk(link);
    expect(link.sections).toEqual([
      expect.objectContaining({ kind: "state", reason: "symlink" }),
    ]);
  });

  it("超大正文返回类型化 state", async () => {
    const root = await createRepository();
    await writeFile(
      join(root, "large.txt"),
      `${"x".repeat(1024)}\n`.repeat(800),
      "utf8"
    );
    const service = new GitReviewService();
    const large = await service.getFileDocument(
      request(source(root, "large.txt"))
    );

    expectOk(large);
    expect(large.sections).toEqual([
      expect.objectContaining({ kind: "state", reason: "tooLarge" }),
    ]);
  });

  it("保留 CRLF 与无末尾换行标记，并在一次竞态后有限重试", async () => {
    const root = await createRepository();
    await writeFile(join(root, "file.txt"), "base\r\n", "utf8");
    await commitAll(root, "base");
    await writeFile(join(root, "file.txt"), "first", "utf8");
    let mutated = false;
    const wrappedExec: ExecGitRaw = async (args, options) => {
      const result = await execGitRaw(args, options);
      if (
        !mutated &&
        args.includes("--patch-with-raw") &&
        !args.includes("--cached")
      ) {
        mutated = true;
        await writeFile(join(root, "file.txt"), "second", "utf8");
      }
      return result;
    };

    const result = await new GitReviewService({
      execGitRaw: wrappedExec,
    }).getFileDocument(request(source(root, "file.txt")));

    expectOk(result);
    expect(mutated).toBe(true);
    expect(result.sections[0]).toMatchObject({ kind: "patch" });
    expect(
      result.sections[0]?.kind === "patch" && result.sections[0].patch
    ).toContain("\\ No newline at end of file");
    expect(
      result.sections[0]?.kind === "patch" && result.sections[0].patch
    ).toContain("-base\r");
    expect(
      result.sections[0]?.kind === "patch" && result.sections[0].patch
    ).toContain("+second");
  });

  it("staged-only 的 index A→B→A 竞态不会返回 B patch", async () => {
    const root = await createRepository();
    await writeFile(join(root, "file.txt"), "base\n", "utf8");
    await commitAll(root, "base");
    await writeFile(join(root, "file.txt"), "A\n", "utf8");
    await execGit(["add", "--", "file.txt"], { cwd: root });
    let patchCalls = 0;
    const wrappedExec: ExecGitRaw = async (args, options) => {
      if (
        patchCalls === 0 &&
        args.includes("--patch-with-raw") &&
        args.includes("--cached")
      ) {
        patchCalls += 1;
        await writeFile(join(root, "file.txt"), "B\n", "utf8");
        await execGit(["add", "--", "file.txt"], { cwd: root });
        const result = await execGitRaw(args, options);
        await writeFile(join(root, "file.txt"), "A\n", "utf8");
        await execGit(["add", "--", "file.txt"], { cwd: root });
        return result;
      }
      if (args.includes("--patch-with-raw") && args.includes("--cached")) {
        patchCalls += 1;
      }
      return execGitRaw(args, options);
    };

    const result = await new GitReviewService({
      execGitRaw: wrappedExec,
    }).getFileDocument(request(source(root, "file.txt")));

    expectOk(result);
    expect(patchCalls).toBeGreaterThanOrEqual(2);
    const section = result.sections[0];
    expect(section?.kind === "patch" && section.patch).toContain("+A");
    expect(section?.kind === "patch" && section.patch).not.toContain("+B");
  });

  it("无关文件持续变化不会让单文件 document 失效", async () => {
    const root = await createRepository();
    await writeFile(join(root, "file.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await writeFile(join(root, "file.ts"), "changed\n", "utf8");
    const delegate = new GitReviewIndexReader();
    let generation = 0;
    const indexReader: Pick<GitReviewIndexReader, "read" | "resolve"> = {
      read: delegate.read.bind(delegate),
      resolve: async (indexRequest, options) => {
        const result = await delegate.resolve(indexRequest, options);
        await writeFile(
          join(root, `noise-${generation}.txt`),
          `${generation}\n`,
          "utf8"
        );
        generation += 1;
        return result;
      },
    };

    const result = await new GitReviewService({ indexReader }).getFileDocument(
      request(source(root, "file.ts"))
    );

    expectOk(result);
    expect(generation).toBe(2);
  });

  it("conflict 不伪造文本统计", async () => {
    const conflictRoot = await createRepository();
    await writeFile(join(conflictRoot, "conflict.ts"), "base\n", "utf8");
    await commitAll(conflictRoot, "base");
    const mainBranch = (
      await execGit(["branch", "--show-current"], { cwd: conflictRoot })
    ).trim();
    await execGit(["switch", "-c", "other"], { cwd: conflictRoot });
    await writeFile(join(conflictRoot, "conflict.ts"), "other\n", "utf8");
    await commitAll(conflictRoot, "other");
    await execGit(["switch", mainBranch], { cwd: conflictRoot });
    await writeFile(join(conflictRoot, "conflict.ts"), "main\n", "utf8");
    await commitAll(conflictRoot, "main");
    await execGit(["merge", "other"], { cwd: conflictRoot }).catch(
      () => undefined
    );

    const conflict = await new GitReviewService().getFileDocument(
      request(source(conflictRoot, "conflict.ts"))
    );
    expectOk(conflict);
    expect(conflict.sections).toEqual([
      expect.objectContaining({
        kind: "state",
        reason: "conflict",
      }),
    ]);
  });

  it("submodule 不伪造文本统计", async () => {
    const child = await createRepository();
    await writeFile(join(child, "child.ts"), "base\n", "utf8");
    await commitAll(child, "child base");
    const parent = await createRepository();
    await execGit(
      ["-c", "protocol.file.allow=always", "submodule", "add", child, "sub"],
      { cwd: parent }
    );
    await commitAll(parent, "add submodule");
    await execGit(["config", "user.name", "Pier Test"], {
      cwd: join(parent, "sub"),
    });
    await execGit(["config", "user.email", "pier@example.invalid"], {
      cwd: join(parent, "sub"),
    });
    await writeFile(join(parent, "sub", "child.ts"), "next\n", "utf8");
    await commitAll(join(parent, "sub"), "child next");

    const submodule = await new GitReviewService().getFileDocument(
      request(source(parent, "sub"))
    );
    expectOk(submodule);
    expect(submodule.sections).toEqual([
      expect.objectContaining({
        kind: "state",
        reason: "submodule",
      }),
    ]);
  });
});
