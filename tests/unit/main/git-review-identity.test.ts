import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "@main/services/git-exec.ts";
import { GitReviewBudget } from "@main/services/git-review/git-review-budget.ts";
import {
  GitReviewIdentityError,
  GitReviewIdentityResolver,
  type GitReviewObjectFormat,
} from "@main/services/git-review/git-review-identity.ts";
import { raceGitReviewIdentityBoundary } from "@main/services/git-review/git-review-identity-boundary.ts";
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

async function commitFile(root: string): Promise<string> {
  await writeFile(join(root, "file.txt"), "content\n", "utf8");
  await execGit(["add", "--", "file.txt"], { cwd: root });
  await execGit(["commit", "-m", "base"], { cwd: root });
  return (await execGit(["rev-parse", "HEAD"], { cwd: root })).trim();
}

describe("GitReviewIdentityResolver", () => {
  it("独立 tracker 在本地超时后接管未结算底层操作", async () => {
    vi.useFakeTimers();
    let resolveOperation: () => void = () => undefined;
    const operation = new Promise<void>((resolve) => {
      resolveOperation = resolve;
    });
    const trackDetachedOperation = vi.fn();
    const read = raceGitReviewIdentityBoundary(() => operation, {
      timeoutMs: 10,
      trackDetachedOperation,
    });
    const error = read.catch((reason: unknown) => reason);

    await vi.advanceTimersByTimeAsync(10);

    await expect(error).resolves.toMatchObject({ kind: "timeout" });
    expect(trackDetachedOperation).toHaveBeenCalledWith(operation);
    resolveOperation();
  });

  it("规范化仓库根并保留 unborn HEAD", async () => {
    const root = await createRepository("sha1");
    const linkRoot = await mkdtemp(join(tmpdir(), "pier-review-link-"));
    roots.push(linkRoot);
    const link = join(linkRoot, "repo-link");
    await symlink(root, link);

    await expect(
      new GitReviewIdentityResolver().resolveRepository(link)
    ).resolves.toEqual({
      canonicalRoot: await realpath(root),
      headOid: null,
      objectFormat: "sha1",
      oidLength: 40,
    });
  });

  it("保留仓库根中的尾空格、Tab、CR 和 LF", async () => {
    const parent = await mkdtemp(join(tmpdir(), "pier-review-special-"));
    roots.push(parent);
    const repo = join(parent, "repo \t\r\n");
    await mkdir(repo);
    await execGit(["init", "--object-format=sha1"], { cwd: repo });

    await expect(
      new GitReviewIdentityResolver().resolveRepositoryBase(repo)
    ).resolves.toMatchObject({ canonicalRoot: await realpath(repo) });
  });

  it("读取请求开始时的 HEAD", async () => {
    const root = await createRepository("sha1");
    const headOid = await commitFile(root);

    await expect(
      new GitReviewIdentityResolver().resolveRepository(root)
    ).resolves.toMatchObject({ headOid, objectFormat: "sha1", oidLength: 40 });
  });

  it("非 Git 目录返回 notRepository", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-review-not-repo-"));
    roots.push(root);

    await expect(
      new GitReviewIdentityResolver().resolveRepository(root)
    ).rejects.toMatchObject({ kind: "notRepository" });
  });

  it("支持 SHA-256 仓库", async (ctx) => {
    let root: string;
    try {
      root = await createRepository("sha256");
    } catch {
      ctx.skip();
      return;
    }
    const headOid = await commitFile(root);

    await expect(
      new GitReviewIdentityResolver().resolveRepository(root)
    ).resolves.toMatchObject({
      headOid,
      objectFormat: "sha256",
      oidLength: 64,
    });
  });

  it("已到期预算在 realpath 前终止并保留 timeout 原因", async () => {
    const budget = new GitReviewBudget({ deadlineAtMs: Date.now() - 1 });
    const execGitRaw = vi.fn(async () => ({
      kind: "collected" as const,
      stderrBytes: 0,
      stderrTail: Buffer.alloc(0),
      stdout: Buffer.from("/repo\n"),
      stdoutBytes: 6,
    }));
    const resolveRealpath = vi.fn(async (value: string) => value);
    const resolver = new GitReviewIdentityResolver({
      execGitRaw,
      realpath: resolveRealpath,
    });

    const error = await resolver
      .resolveRepositoryBase("/repo", { budget })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(GitReviewIdentityError);
    expect((error as GitReviewIdentityError).kind).toBe("timeout");
    expect(resolveRealpath).not.toHaveBeenCalled();
  });

  it("取消 realpath 时把未结算底层 Promise 登记给调度预算", async () => {
    const controller = new AbortController();
    let resolveRealpath: (value: string) => void = () => undefined;
    const pendingRealpath = new Promise<string>((resolve) => {
      resolveRealpath = resolve;
    });
    const trackDetachedOperation = vi.fn();
    const realpathCall = vi.fn(() => pendingRealpath);
    const resolver = new GitReviewIdentityResolver({
      execGitRaw: async () => ({
        kind: "collected" as const,
        stderrBytes: 0,
        stderrTail: Buffer.alloc(0),
        stdout: Buffer.from("/repo\n"),
        stdoutBytes: 6,
      }),
      realpath: realpathCall,
    });
    const read = resolver.resolveRepositoryBase("/repo", {
      budget: {
        consumeOutputBytes: () => "ok",
        failureReason: () => null,
        remainingTimeMs: () => 1000,
        signal: controller.signal,
        trackDetachedOperation,
      },
    });
    await vi.waitFor(() => expect(realpathCall).toHaveBeenCalledOnce());

    controller.abort("caller");
    await expect(read).rejects.toMatchObject({ kind: "aborted" });
    expect(trackDetachedOperation).toHaveBeenCalledWith(pendingRealpath);
    resolveRealpath("/repo");
  });

  it.each([
    Buffer.from("/repo\0bad\n"),
    Buffer.from([0xff, 0x0a]),
  ])("拒绝含 NUL 或非法 UTF-8 的路径输出", async (stdout) => {
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
