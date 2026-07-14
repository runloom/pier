import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExecGitRaw,
  execGit,
  type GitExecRawResult,
} from "@main/services/git-exec.ts";
import { GitReviewBudget } from "@main/services/git-review/git-review-budget.ts";
import {
  GitReviewIdentityError,
  GitReviewIdentityResolver,
  type GitReviewObjectFormat,
  type GitReviewRepositoryBaseIdentity,
} from "@main/services/git-review/git-review-identity.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function createRepository(
  objectFormat: GitReviewObjectFormat
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `pier-review-${objectFormat}-`));
  roots.push(root);
  await execGit(["init", `--object-format=${objectFormat}`], { cwd: root });
  await execGit(["config", "user.name", "Pier Test"], { cwd: root });
  await execGit(["config", "user.email", "pier@example.invalid"], {
    cwd: root,
  });
  return root;
}

async function commitFile(root: string, contents: string): Promise<string> {
  await writeFile(join(root, "file.txt"), contents, "utf8");
  await execGit(["add", "--", "file.txt"], { cwd: root });
  await execGit(["commit", "-m", `commit ${contents}`], { cwd: root });
  return (await execGit(["rev-parse", "HEAD"], { cwd: root })).trim();
}

describe("GitReviewIdentityResolver", () => {
  it("realpath 规范化仓库根，并为 unborn HEAD 动态计算 SHA-1 空树", async () => {
    const root = await createRepository("sha1");
    const linkRoot = await mkdtemp(join(tmpdir(), "pier-review-link-"));
    roots.push(linkRoot);
    const link = join(linkRoot, "repo-link");
    await symlink(root, link);

    const identity = await new GitReviewIdentityResolver().resolveRepository(
      link
    );
    const nativeEmptyTree = (
      await execGit(["hash-object", "-t", "tree", "--stdin"], { cwd: root })
    ).trim();

    expect(identity).toEqual({
      canonicalRoot: await realpath(root),
      emptyTreeOid: nativeEmptyTree,
      headOid: null,
      objectFormat: "sha1",
      oidLength: 40,
    });
    expect(identity.emptyTreeOid).toHaveLength(40);
  });

  it("非 Git 目录在仓库解析阶段返回 notRepository", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-review-not-repo-"));
    roots.push(root);

    await expect(
      new GitReviewIdentityResolver().resolveRepository(root)
    ).rejects.toMatchObject({ kind: "notRepository" });
  });

  it("root commit 没有 first parent，后续 commit 返回正确 first parent", async () => {
    const root = await createRepository("sha1");
    const first = await commitFile(root, "first");
    const resolver = new GitReviewIdentityResolver();

    const rootCommit = await resolver.resolveCommit(root, first);
    expect(rootCommit).toEqual({
      firstParentOid: null,
      oid: first,
      parentOids: [],
    });

    const second = await commitFile(root, "second");
    const childCommit = await resolver.resolveCommit(root, second);
    expect(childCommit.firstParentOid).toBe(first);
    expect(childCommit.parentOids).toEqual([first]);
  });

  it("以请求开始时的 HEAD 固定 branch target 和 merge-base", async () => {
    const root = await createRepository("sha1");
    const base = await commitFile(root, "base");
    await execGit(["branch", "review-target", base], { cwd: root });
    const head = await commitFile(root, "head");
    const resolver = new GitReviewIdentityResolver();
    const repository = await resolver.resolveRepository(root);

    await expect(
      resolver.resolveBranchInRepository(
        repository,
        "refs/heads/review-target",
        repository.headOid
      )
    ).resolves.toEqual({
      headOid: head,
      mergeBaseOid: base,
      targetOid: base,
      targetRef: "refs/heads/review-target",
    });
    await expect(
      resolver.resolveBranchInRepository(
        repository,
        "refs/heads/missing",
        repository.headOid
      )
    ).rejects.toMatchObject({ kind: "invalidReference" });
  });

  it("unborn HEAD 不会被隐式替换成其他 ref", async () => {
    const root = await createRepository("sha1");
    const resolver = new GitReviewIdentityResolver();
    const repository = await resolver.resolveRepository(root);

    await expect(
      resolver.resolveBranchInRepository(
        repository,
        "refs/heads/main",
        repository.headOid
      )
    ).rejects.toMatchObject({ kind: "unbornHead" });
  });

  it("不存在的 commit 与 unborn HEAD 都返回 invalidReference", async () => {
    const root = await createRepository("sha1");
    const resolver = new GitReviewIdentityResolver();
    const repository = await resolver.resolveRepository(root);

    await expect(
      resolver.resolveCommitInRepository(repository, "refs/heads/missing")
    ).rejects.toMatchObject({ kind: "invalidReference" });
    await expect(
      resolver.resolveCommitInRepository(repository, "HEAD")
    ).rejects.toMatchObject({ kind: "invalidReference" });
  });

  it("支持 SHA-256 仓库的 unborn、root commit 与动态空树", async (ctx) => {
    let root: string;
    try {
      root = await createRepository("sha256");
    } catch {
      ctx.skip();
      return;
    }
    const resolver = new GitReviewIdentityResolver();
    const unborn = await resolver.resolveRepository(root);
    expect(unborn.objectFormat).toBe("sha256");
    expect(unborn.oidLength).toBe(64);
    expect(unborn.headOid).toBeNull();
    expect(unborn.emptyTreeOid).toHaveLength(64);

    const oid = await commitFile(root, "sha256 root");
    const repository = await resolver.resolveRepository(root);
    const commit = await resolver.resolveCommit(root, oid);
    expect(repository.headOid).toBe(oid);
    expect(repository.emptyTreeOid).toHaveLength(64);
    expect(commit.firstParentOid).toBeNull();
    expect(commit.oid).toHaveLength(64);
  });

  it("已有 repository identity 时解析 commit 固定只需两条命令", async () => {
    const oid = "a".repeat(40);
    const parent = "b".repeat(40);
    const execGitRaw = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "collected",
        stderrBytes: 0,
        stderrTail: Buffer.alloc(0),
        stdout: Buffer.from(`${oid}\n`),
        stdoutBytes: 41,
      })
      .mockResolvedValueOnce({
        kind: "collected",
        stderrBytes: 0,
        stderrTail: Buffer.alloc(0),
        stdout: Buffer.from(`${oid} ${parent}\n`),
        stdoutBytes: 82,
      });
    const repository: GitReviewRepositoryBaseIdentity = {
      canonicalRoot: "/repo",
      objectFormat: "sha1",
      oidLength: 40,
    };
    const resolver = new GitReviewIdentityResolver({
      execGitRaw,
      realpath: async (value) => value,
    });

    await expect(
      resolver.resolveCommitInRepository(repository, "HEAD")
    ).resolves.toMatchObject({ oid, parentOids: [parent] });
    expect(execGitRaw).toHaveBeenCalledTimes(2);
    expect(execGitRaw.mock.calls.map(([args]) => args[0])).toEqual([
      "rev-parse",
      "rev-list",
    ]);
  });

  it("一条并行 identity 命令失败会取消 sibling", async () => {
    let siblingAborted = false;
    let rejectSibling: (error: Error) => void = () => undefined;
    const execGitRaw: ExecGitRaw = vi.fn((args, options) => {
      const command = args.join(" ");
      if (command.includes("show-toplevel")) {
        return Promise.resolve({
          kind: "collected" as const,
          stderrBytes: 0,
          stderrTail: Buffer.alloc(0),
          stdout: Buffer.from("/repo\n"),
          stdoutBytes: 6,
        });
      }
      if (command.includes("show-object-format")) {
        return Promise.resolve({
          kind: "collected" as const,
          stderrBytes: 0,
          stderrTail: Buffer.alloc(0),
          stdout: Buffer.from("sha1\n"),
          stdoutBytes: 5,
        });
      }
      if (command.includes("HEAD^{commit}")) {
        return Promise.reject(new Error("head failed"));
      }
      return new Promise<GitExecRawResult>((_, reject) => {
        rejectSibling = reject;
        options.signal?.addEventListener(
          "abort",
          () => {
            siblingAborted = true;
          },
          { once: true }
        );
      });
    });
    const resolver = new GitReviewIdentityResolver({
      execGitRaw,
      realpath: async (value) => value,
    });

    const pending = resolver.resolveRepository("/repo");
    const expectation = expect(pending).rejects.toThrow("head failed");
    await vi.waitFor(() => expect(siblingAborted).toBe(true));
    let settled = false;
    pending
      .finally(() => {
        settled = true;
      })
      .catch(() => undefined);
    await Promise.resolve();
    expect(settled).toBe(false);

    rejectSibling(new Error("sibling aborted"));
    await expectation;
  });

  it("共享 budget signal 不经 sibling signal 抢先降级 typed reason", async () => {
    const controller = new AbortController();
    let failureReason: "output-limit" | "timeout" | null = null;
    let parallelCommands = 0;
    const budget = {
      consumeOutputBytes: () => "ok" as const,
      failureReason: () => failureReason,
      remainingTimeMs: () => 1000,
      signal: controller.signal,
    };
    const execGitRaw: ExecGitRaw = vi.fn((args, options) => {
      const command = args.join(" ");
      if (command.includes("show-toplevel")) {
        return Promise.resolve({
          kind: "collected" as const,
          stderrBytes: 0,
          stderrTail: Buffer.alloc(0),
          stdout: Buffer.from("/repo\n"),
          stdoutBytes: 6,
        });
      }
      if (command.includes("show-object-format")) {
        return Promise.resolve({
          kind: "collected" as const,
          stderrBytes: 0,
          stderrTail: Buffer.alloc(0),
          stdout: Buffer.from("sha1\n"),
          stdoutBytes: 5,
        });
      }
      parallelCommands += 1;
      return new Promise<GitExecRawResult>((_, reject) => {
        options.signal?.addEventListener(
          "abort",
          () => reject(new Error("downgraded-to-aborted")),
          { once: true }
        );
        options.budget?.signal.addEventListener(
          "abort",
          () => reject(new Error(`typed:${options.budget?.failureReason()}`)),
          { once: true }
        );
      });
    });
    const resolver = new GitReviewIdentityResolver({
      execGitRaw,
      realpath: async (value) => value,
    });
    const pending = resolver.resolveRepository("/repo", {
      budget,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(parallelCommands).toBe(2));

    failureReason = "output-limit";
    controller.abort("output-limit");

    await expect(pending).rejects.toThrow("typed:output-limit");
  });

  it("realpath 在 preflight 通过后才启动，并把 budget timeout 保留为 timeout", async () => {
    const budget = new GitReviewBudget({ deadlineAtMs: Date.now() - 1 });
    const execGitRaw = vi.fn(async () => ({
      kind: "collected" as const,
      stderrBytes: 0,
      stderrTail: Buffer.alloc(0),
      stdout: Buffer.from("/repo\n"),
      stdoutBytes: 6,
    }));
    const realpath = vi.fn(async (value: string) => value);
    const resolver = new GitReviewIdentityResolver({ execGitRaw, realpath });

    const error = await resolver
      .resolveRepositoryBase("/repo", { budget })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(GitReviewIdentityError);
    expect((error as GitReviewIdentityError).kind).toBe("timeout");
    expect(realpath).not.toHaveBeenCalled();
  });

  it.each([
    ["timeoutMs", Number.NaN],
    ["timeoutMs", Number.MAX_SAFE_INTEGER],
    ["deadlineAtMs", Number.POSITIVE_INFINITY],
    ["deadlineAtMs", Number.MAX_SAFE_INTEGER],
  ] as const)("非法 %s=%s 在 identity preflight 拒绝", async (name, value) => {
    const execGitRaw = vi.fn();
    const realpath = vi.fn(async (path: string) => path);
    const resolver = new GitReviewIdentityResolver({ execGitRaw, realpath });

    const error = await resolver
      .resolveRepositoryBase("/repo", { [name]: value })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(GitReviewIdentityError);
    expect((error as GitReviewIdentityError).kind).toBe("configuration");
    expect(execGitRaw).not.toHaveBeenCalled();
    expect(realpath).not.toHaveBeenCalled();
  });

  it("realpath 等待期间会重新读取 late lease 扩展后的共享期限", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let remainingMs = 10;
    const budget = {
      consumeOutputBytes: () => "ok" as const,
      failureReason: () => null,
      remainingTimeMs: () => remainingMs,
      signal: controller.signal,
    };
    const execGitRaw: ExecGitRaw = vi.fn(async (args) => {
      const stdout = args.includes("--show-toplevel")
        ? Buffer.from("/repo\n")
        : Buffer.from("sha1\n");
      return {
        kind: "collected" as const,
        stderrBytes: 0,
        stderrTail: Buffer.alloc(0),
        stdout,
        stdoutBytes: stdout.length,
      };
    });
    let resolveRealpath: (value: string) => void = () => undefined;
    const realpath = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRealpath = resolve;
        })
    );
    const resolver = new GitReviewIdentityResolver({ execGitRaw, realpath });
    const pending = resolver.resolveRepositoryBase("/repo", { budget });
    await Promise.resolve();
    await Promise.resolve();
    expect(realpath).toHaveBeenCalledOnce();

    remainingMs = 100;
    await vi.advanceTimersByTimeAsync(10);
    resolveRealpath("/repo");

    await expect(pending).resolves.toMatchObject({ canonicalRoot: "/repo" });
  });

  it.each([
    Buffer.from("/repo\n/other\n"),
    Buffer.from([0xff, 0x0a]),
  ])("拒绝多行或非法 UTF-8 identity 输出", async (stdout) => {
    const execGitRaw = vi.fn(async () => ({
      kind: "collected" as const,
      stderrBytes: 0,
      stderrTail: Buffer.alloc(0),
      stdout,
      stdoutBytes: stdout.length,
    }));
    const resolver = new GitReviewIdentityResolver({
      execGitRaw,
      realpath: async (value) => value,
    });

    await expect(
      resolver.resolveRepositoryBase("/repo")
    ).rejects.toBeInstanceOf(GitReviewIdentityError);
  });
});
