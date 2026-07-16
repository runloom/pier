import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GitReviewPathError,
  readGitReviewFileSnapshot,
} from "@main/services/git-review/git-review-path-guard.ts";
import { raceGitReviewPathOperation } from "@main/services/git-review/git-review-path-operation.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPathOpen } = vi.hoisted(() => ({
  mockPathOpen:
    vi.fn<
      typeof import("@main/services/git-review/git-review-path-open.ts").openGitReviewFileNoSymlinks
    >(),
}));

vi.mock(
  "@main/services/git-review/git-review-path-open.ts",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@main/services/git-review/git-review-path-open.ts")
      >();
    mockPathOpen.mockImplementation(actual.openGitReviewFileNoSymlinks);
    return { ...actual, openGitReviewFileNoSymlinks: mockPathOpen };
  }
);

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  mockPathOpen.mockClear();
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

it("取消文件系统调用时登记仍未结算的底层 Promise", async () => {
  const controller = new AbortController();
  let settle: (value: string) => void = () => undefined;
  const pending = new Promise<string>((resolve) => {
    settle = resolve;
  });
  const trackDetachedOperation = vi.fn();
  const read = raceGitReviewPathOperation(
    () => pending,
    controller.signal,
    undefined,
    {
      consumeOutputBytes: () => "ok",
      failureReason: () => null,
      remainingTimeMs: () => 1000,
      signal: controller.signal,
      trackDetachedOperation,
    }
  );

  controller.abort("caller");
  await expect(read).rejects.toMatchObject({ reason: "aborted" });
  expect(trackDetachedOperation).toHaveBeenCalledWith(pending);
  settle("late");
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pier-review-path-"));
  roots.push(root);
  return realpath(root);
}

async function expectPathReason(
  promise: Promise<unknown>,
  reason: GitReviewPathError["reason"]
): Promise<void> {
  const error = await promise.catch((value: unknown) => value);
  expect(error).toBeInstanceOf(GitReviewPathError);
  expect((error as GitReviewPathError).reason).toBe(reason);
}

describe("Git Review path guard", () => {
  it("从同一 fd 返回有界快照、执行位和稳定摘要", async () => {
    const root = await createRoot();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "a.ts"), "hello\n", "utf8");
    await chmod(join(root, "src", "a.ts"), 0o755);

    const snapshot = await readGitReviewFileSnapshot({
      gitRootPath: root,
      path: "src/a.ts",
    });

    expect(snapshot).toMatchObject({
      bytes: Buffer.from("hello\n"),
      executable: true,
      size: 6,
    });
    expect(snapshot.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("拒绝越界、父级符号链接、最终符号链接和目录", async () => {
    const root = await createRoot();
    const outside = await createRoot();
    await writeFile(join(outside, "outside.txt"), "outside", "utf8");
    await symlink(outside, join(root, "parent-link"));
    await symlink(join(outside, "outside.txt"), join(root, "file-link"));
    await mkdir(join(root, "directory"));

    await expectPathReason(
      readGitReviewFileSnapshot({ gitRootPath: root, path: "../outside.txt" }),
      "outsideRoot"
    );
    await expectPathReason(
      readGitReviewFileSnapshot({
        gitRootPath: root,
        path: "parent-link/outside.txt",
      }),
      "symlink"
    );
    await expectPathReason(
      readGitReviewFileSnapshot({ gitRootPath: root, path: "file-link" }),
      "symlink"
    );
    await expectPathReason(
      readGitReviewFileSnapshot({ gitRootPath: root, path: "directory" }),
      "notRegular"
    );
  });

  it("以 O_NONBLOCK 拒绝 FIFO 与 Unix socket，不阻塞线程池", async (ctx) => {
    if (process.platform === "win32") {
      ctx.skip();
      return;
    }
    const root = await createRoot();
    const fifo = join(root, "pipe");
    const mkfifo = spawnSync("mkfifo", [fifo]);
    if (mkfifo.status !== 0) {
      ctx.skip();
      return;
    }
    const socket = join(root, "socket");
    const server = createServer();
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socket, resolve);
    });

    const reads = Promise.all([
      expectPathReason(
        readGitReviewFileSnapshot({ gitRootPath: root, path: "pipe" }),
        "notRegular"
      ),
      expectPathReason(
        readGitReviewFileSnapshot({ gitRootPath: root, path: "socket" }),
        "readFailed"
      ),
    ]);
    await expect(
      Promise.race([
        reads.then(() => "done"),
        new Promise<string>((resolve) => setTimeout(resolve, 1000, "timeout")),
      ])
    ).resolves.toBe("done");
  });

  it("文件超过读取上限时不分配正文", async () => {
    const root = await createRoot();
    await writeFile(join(root, "large.txt"), "12345", "utf8");

    await expectPathReason(
      readGitReviewFileSnapshot({
        gitRootPath: root,
        maxBytes: 4,
        path: "large.txt",
      }),
      "tooLarge"
    );
  });

  it("正文读取成功后 close 拒绝会返回 readFailed", async (ctx) => {
    if (process.platform !== "darwin") {
      ctx.skip();
      return;
    }
    const root = await createRoot();
    await writeFile(join(root, "close.txt"), "content\n", "utf8");
    const handle = await open(join(root, "close.txt"), "r");
    const realClose = handle.close;
    const close = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(
        Object.assign(new Error("close failed"), { code: "EIO" })
      );
    handle.close = close;
    mockPathOpen.mockResolvedValueOnce(handle);

    await expectPathReason(
      readGitReviewFileSnapshot({ gitRootPath: root, path: "close.txt" }),
      "readFailed"
    );
    expect(close).toHaveBeenCalledTimes(1);
    handle.close = realClose;
    await handle.close();
  });

  it("正文读取成功后 close 同步异常会返回 readFailed", async (ctx) => {
    if (process.platform !== "darwin") {
      ctx.skip();
      return;
    }
    const root = await createRoot();
    await writeFile(join(root, "close.txt"), "content\n", "utf8");
    const handle = await open(join(root, "close.txt"), "r");
    const realClose = handle.close;
    const close = vi.fn<() => Promise<void>>().mockImplementation(() => {
      throw Object.assign(new Error("close threw"), { code: "EIO" });
    });
    handle.close = close;
    mockPathOpen.mockResolvedValueOnce(handle);

    await expectPathReason(
      readGitReviewFileSnapshot({ gitRootPath: root, path: "close.txt" }),
      "readFailed"
    );
    expect(close).toHaveBeenCalledTimes(1);
    handle.close = realClose;
    await handle.close();
  });

  it("正文已失败时保留原错误，不被 close 异常覆盖", async (ctx) => {
    if (process.platform !== "darwin") {
      ctx.skip();
      return;
    }
    const root = await createRoot();
    await writeFile(join(root, "large.txt"), "12345", "utf8");
    const handle = await open(join(root, "large.txt"), "r");
    const realClose = handle.close;
    const close = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(
        Object.assign(new Error("close failed"), { code: "EIO" })
      );
    handle.close = close;
    mockPathOpen.mockResolvedValueOnce(handle);

    await expectPathReason(
      readGitReviewFileSnapshot({
        gitRootPath: root,
        maxBytes: 4,
        path: "large.txt",
      }),
      "tooLarge"
    );
    expect(close).toHaveBeenCalledTimes(1);
    handle.close = realClose;
    await handle.close();
  });
});
