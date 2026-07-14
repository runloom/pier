import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
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
import { GitReviewIndexReader } from "@main/services/git-review/git-review-index.ts";
import { GitReviewService } from "@main/services/git-review/git-review-service.ts";
import type {
  GitDiffPanelSource,
  GitReviewFileDocumentRequest,
  GitReviewFileDocumentResult,
} from "@shared/contracts/git-review.ts";
import { afterEach, describe, expect, it } from "vitest";

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

function request(
  source: GitDiffPanelSource,
  options: { clientHasDocument?: boolean; ifRevision?: string | null } = {}
): GitReviewFileDocumentRequest {
  return {
    clientHasDocument: options.clientHasDocument ?? false,
    ifRevision: options.ifRevision ?? null,
    operationId: randomUUID(),
    source,
  };
}

function source(
  root: string,
  path: string,
  query: GitDiffPanelSource["query"] = {
    groups: ["unstaged", "staged"],
    kind: "uncommitted",
  }
): GitDiffPanelSource {
  return {
    contextId: "worktree:test",
    gitRootPath: root,
    path,
    query,
  };
}

function expectOk(
  result: GitReviewFileDocumentResult
): asserts result is Extract<GitReviewFileDocumentResult, { kind: "ok" }> {
  expect(result.kind).toBe("ok");
}

describe("GitReviewService document", () => {
  it("以未暂存→已暂存顺序返回两个 patch section，并支持条件命中", async () => {
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
    expect(result.sections).toHaveLength(2);
    expect(result.sections.map((section) => section.group)).toEqual([
      "unstaged",
      "staged",
    ]);
    expect(result.sections).toEqual([
      expect.objectContaining({
        additions: 1,
        deletions: 0,
        kind: "patch",
        path: "file.ts",
      }),
      expect.objectContaining({
        additions: 1,
        deletions: 1,
        kind: "patch",
        path: "file.ts",
      }),
    ]);
    await expect(
      service.getFileDocument(
        request(documentSource, {
          clientHasDocument: true,
          ifRevision: result.revision,
        })
      )
    ).resolves.toEqual({
      kind: "notModified",
      revision: result.revision,
      source: result.source,
    });
  });

  it("链式 a→b→c 为每个 group 使用自己的 old/target path", async () => {
    const root = await createRepository();
    await writeFile(join(root, "a.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await execGit(["mv", "a.ts", "b.ts"], { cwd: root });
    await rename(join(root, "b.ts"), join(root, "c.ts"));
    await execGit(["add", "-N", "--", "c.ts"], { cwd: root });

    const result = await new GitReviewService().getFileDocument(
      request(source(root, "c.ts"))
    );

    expectOk(result);
    expect(result.sections).toEqual([
      expect.objectContaining({
        group: "unstaged",
        oldPath: "b.ts",
        path: "c.ts",
      }),
      expect.objectContaining({
        group: "staged",
        oldPath: "a.ts",
        path: "b.ts",
      }),
    ]);
  });

  it("副本源在同一范围修改时只返回副本条目 patch", async () => {
    const root = await createRepository();
    await writeFile(join(root, "source.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await copyFile(join(root, "source.ts"), join(root, "copy.ts"));
    await writeFile(join(root, "source.ts"), "base\nsource changed\n", "utf8");
    await execGit(["add", "-A", "--"], { cwd: root });

    const result = await new GitReviewService().getFileDocument(
      request(
        source(root, "copy.ts", {
          groups: ["staged"],
          kind: "uncommitted",
        })
      )
    );

    expectOk(result);
    expect(result.sections).toEqual([
      expect.objectContaining({
        group: "staged",
        kind: "patch",
        oldPath: "source.ts",
        path: "copy.ts",
      }),
    ]);
    const section = result.sections[0];
    expect(section?.kind).toBe("patch");
    if (section?.kind === "patch") {
      expect(section.patch.match(/^diff --git /gmu)).toHaveLength(1);
      expect(section.patch).not.toContain("+source changed");
    }
  });

  it("在 POSIX 上把反斜杠当作 Git 路径字面字符", async (ctx) => {
    if (process.platform === "win32") {
      ctx.skip();
      return;
    }
    const root = await createRepository();
    const paths = ["\\notes.txt", "dir\\..\\file"];
    for (const path of paths) {
      await writeFile(join(root, path), "base\n", "utf8");
    }
    await commitAll(root, "base");
    for (const path of paths) {
      await writeFile(join(root, path), "changed\n", "utf8");
    }

    const service = new GitReviewService();
    for (const path of paths) {
      const result = await service.getFileDocument(
        request(
          source(root, path, {
            groups: ["unstaged"],
            kind: "uncommitted",
          })
        )
      );
      expectOk(result);
      expect(result.sections).toEqual([
        expect.objectContaining({ kind: "patch", path }),
      ]);
    }
  });

  it("两次 document 索引探测共用请求文件预算", async () => {
    const root = await createRepository();
    await writeFile(join(root, "file.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await writeFile(join(root, "file.ts"), "changed\n", "utf8");
    const budget = new GitReviewBudget({ maxFiles: 2 });

    const result = await new GitReviewService().getFileDocument(
      request(
        source(root, "file.ts", {
          groups: ["unstaged"],
          kind: "uncommitted",
        })
      ),
      { budget }
    );

    expectOk(result);
    expect(budget.snapshot().files).toBe(2);
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
      request(source(root, path, { groups: ["unstaged"], kind: "uncommitted" }))
    );

    expectOk(result);
    expect(result.sections).toEqual([
      expect.objectContaining({
        additions: 1,
        deletions: 0,
        kind: "patch",
        oldPath: null,
        path,
        status: "added",
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

  it("二进制与非法 UTF-8 untracked 文件返回类型化 state", async () => {
    const root = await createRepository();
    await writeFile(join(root, "base.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await writeFile(join(root, "binary.dat"), Buffer.from([0, 1, 2]));
    await writeFile(join(root, "invalid.txt"), Buffer.from([0xc3, 0x28]));
    const service = new GitReviewService();

    const binary = await service.getFileDocument(
      request(
        source(root, "binary.dat", {
          groups: ["unstaged"],
          kind: "uncommitted",
        })
      )
    );
    const invalid = await service.getFileDocument(
      request(
        source(root, "invalid.txt", {
          groups: ["unstaged"],
          kind: "uncommitted",
        })
      )
    );

    expectOk(binary);
    expectOk(invalid);
    expect(binary.sections).toEqual([
      expect.objectContaining({ kind: "state", reason: "binary" }),
    ]);
    expect(invalid.sections).toEqual([
      expect.objectContaining({ kind: "state", reason: "invalidEncoding" }),
    ]);
  });

  it("根提交产生单文件 patch", async () => {
    const root = await createRepository();
    await writeFile(join(root, "root.ts"), "root\n", "utf8");
    const rootOid = await commitAll(root, "root");
    const service = new GitReviewService();

    const commit = await service.getFileDocument(
      request(source(root, "root.ts", { kind: "commit", oid: rootOid }))
    );

    expectOk(commit);
    expect(commit.sections).toEqual([
      expect.objectContaining({ group: "commit", kind: "patch" }),
    ]);
  });

  it("branch 固定范围产生单文件 patch", async () => {
    const root = await createRepository();
    await writeFile(join(root, "root.ts"), "root\n", "utf8");
    await commitAll(root, "root");
    await execGit(["branch", "base"], { cwd: root });
    await writeFile(join(root, "root.ts"), "head\n", "utf8");
    await commitAll(root, "head");
    const service = new GitReviewService();

    const branch = await service.getFileDocument(
      request(
        source(root, "root.ts", {
          kind: "branch",
          targetRef: "refs/heads/base",
        })
      )
    );

    expectOk(branch);
    expect(branch.sections).toEqual([
      expect.objectContaining({ group: "branch", kind: "patch" }),
    ]);
  });

  it("deleted、symlink 与超大正文分别返回 patch 或类型化 state", async () => {
    const root = await createRepository();
    await writeFile(join(root, "deleted.ts"), "deleted\n", "utf8");
    await writeFile(join(root, "link.ts"), "regular\n", "utf8");
    await commitAll(root, "base");
    await rm(join(root, "deleted.ts"));
    await rm(join(root, "link.ts"));
    await symlink("deleted.ts", join(root, "link.ts"));
    await writeFile(
      join(root, "large.txt"),
      `${"x".repeat(1024)}\n`.repeat(800),
      "utf8"
    );
    const service = new GitReviewService();
    const unstaged = {
      groups: ["unstaged"] as ["unstaged"],
      kind: "uncommitted" as const,
    };

    const deleted = await service.getFileDocument(
      request(source(root, "deleted.ts", unstaged))
    );
    const link = await service.getFileDocument(
      request(source(root, "link.ts", unstaged))
    );
    const large = await service.getFileDocument(
      request(source(root, "large.txt", unstaged))
    );

    expectOk(deleted);
    expectOk(link);
    expectOk(large);
    expect(deleted.sections).toEqual([
      expect.objectContaining({ kind: "patch", status: "deleted" }),
    ]);
    expect(link.sections).toEqual([
      expect.objectContaining({ kind: "state", reason: "symlink" }),
    ]);
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
    }).getFileDocument(
      request(
        source(root, "file.txt", {
          groups: ["unstaged"],
          kind: "uncommitted",
        })
      )
    );

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

  it("持续变化的 canonical index 在三次尝试后返回 staleRevision", async () => {
    const root = await createRepository();
    await writeFile(join(root, "file.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await writeFile(join(root, "file.ts"), "changed\n", "utf8");
    const delegate = new GitReviewIndexReader();
    let generation = 0;
    const indexReader: Pick<GitReviewIndexReader, "resolve"> = {
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

    await expect(
      new GitReviewService({ indexReader }).getFileDocument(
        request(
          source(root, "file.ts", {
            groups: ["unstaged"],
            kind: "uncommitted",
          })
        )
      )
    ).resolves.toMatchObject({
      kind: "error",
      reason: "staleRevision",
      retryable: true,
    });
    expect(generation).toBe(6);
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
        additions: null,
        deletions: null,
        group: "conflict",
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
      request(
        source(parent, "sub", {
          groups: ["unstaged"],
          kind: "uncommitted",
        })
      )
    );
    expectOk(submodule);
    expect(submodule.sections).toEqual([
      expect.objectContaining({
        additions: null,
        deletions: null,
        kind: "state",
        reason: "submodule",
      }),
    ]);
  });
});
