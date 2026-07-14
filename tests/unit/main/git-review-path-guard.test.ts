import { spawnSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
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
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
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
      expectPathReason(
        readGitReviewFileSnapshot(
          { gitRootPath: root, path: "device" },
          {
            lstat,
            open: async () => open("/dev/null", "r"),
            realpath,
          }
        ),
        "notRegular"
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

  it("取消时不等待卡住的文件打开操作", async () => {
    const root = await createRoot();
    await writeFile(join(root, "slow.txt"), "content\n", "utf8");
    const controller = new AbortController();
    let releaseOpen: () => void = () => undefined;
    let markOpenStarted: () => void = () => undefined;
    const openStarted = new Promise<void>((resolve) => {
      markOpenStarted = resolve;
    });
    const openGate = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
    const reading = readGitReviewFileSnapshot(
      {
        gitRootPath: root,
        path: "slow.txt",
        signal: controller.signal,
      },
      {
        lstat,
        open: async (...args) => {
          markOpenStarted();
          await openGate;
          return open(...args);
        },
        realpath,
      }
    );
    await openStarted;

    controller.abort("caller");
    await expectPathReason(reading, "aborted");
    releaseOpen();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it("打开文件后父目录身份变化会返回 changed", async () => {
    const root = await createRoot();
    const parent = join(root, "src");
    await mkdir(parent);
    await writeFile(join(parent, "a.ts"), "before\n", "utf8");

    await expectPathReason(
      readGitReviewFileSnapshot(
        { gitRootPath: root, path: "src/a.ts" },
        {
          lstat,
          open: async (...args) => {
            const handle = await open(...args);
            await rename(parent, `${parent}-old`);
            await mkdir(parent);
            await writeFile(join(parent, "a.ts"), "after\n", "utf8");
            return handle;
          },
          realpath,
        }
      ),
      "changed"
    );
  });

  it("打开瞬间祖先被替换为外部符号链接时绝不返回外部正文", async (ctx) => {
    if (process.platform !== "darwin") {
      ctx.skip();
      return;
    }
    const root = await createRoot();
    const outside = await createRoot();
    const ancestor = join(root, "src");
    await mkdir(join(ancestor, "nested"), { recursive: true });
    await mkdir(join(outside, "nested"));
    await writeFile(join(ancestor, "nested", "a.ts"), "inside\n", "utf8");
    await writeFile(
      join(outside, "nested", "a.ts"),
      "outside-secret\n",
      "utf8"
    );

    const result = readGitReviewFileSnapshot(
      { gitRootPath: root, path: "src/nested/a.ts" },
      {
        lstat,
        open: async (...args) => {
          await rename(ancestor, `${ancestor}-original`);
          await symlink(outside, ancestor);
          return open(...args);
        },
        realpath,
      }
    );

    const error = await result.catch((value: unknown) => value);
    expect(error).toBeInstanceOf(GitReviewPathError);
    expect((error as GitReviewPathError).reason).toMatch(
      /^(?:changed|symlink)$/u
    );
  });
});
