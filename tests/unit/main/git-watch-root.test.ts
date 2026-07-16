import { createCanonicalGitWatchRootResolver } from "@main/ipc/git-watch-root.ts";
import { describe, expect, it, vi } from "vitest";

function asRealpathProbe(
  realpath: (path: string, context: object) => Promise<string>
) {
  return (path: string, context: object) => {
    const result = realpath(path, context);
    return {
      result,
      settled: result.then(
        () => undefined,
        () => undefined
      ),
    };
  };
}

describe("canonical Git watch root", () => {
  it("在 Git 命令前拒绝非绝对、含 NUL 和超长路径", async () => {
    const execute = vi.fn();
    const realpath = vi.fn();
    const resolve = createCanonicalGitWatchRootResolver({
      execute,
      realpathProbe: asRealpathProbe(realpath),
    });

    await expect(resolve("relative/repo")).resolves.toBeNull();
    await expect(resolve("/repo\0escape")).resolves.toBeNull();
    await expect(resolve(`/${"界".repeat(22_000)}`)).resolves.toBeNull();
    expect(realpath).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("先解析请求别名、确认 Git 顶层，再返回 canonical root", async () => {
    const execute = vi.fn(async () => "/canonical/repo\n");
    const realpath = vi
      .fn()
      .mockResolvedValueOnce("/resolved/alias")
      .mockResolvedValueOnce("/canonical/repo");
    const resolve = createCanonicalGitWatchRootResolver({
      execute,
      realpathProbe: asRealpathProbe(realpath),
    });

    await expect(resolve("/repo-alias")).resolves.toBe("/canonical/repo");
    expect(execute).toHaveBeenCalledWith(
      ["rev-parse", "--path-format=absolute", "--show-toplevel"],
      expect.objectContaining({
        cwd: "/resolved/alias",
        maxOutputBytes: 65_536,
        timeoutMs: 5000,
      })
    );
  });

  it.each([
    " ",
    "\t",
    "\r",
    "\n",
    "中间\n换行",
  ])("只移除 Git 协议的终止 LF，保留路径中的特殊空白 %j", async (suffix) => {
    const expected = `/canonical/repo${suffix}`;
    const execute = vi.fn(async () => `${expected}\n`);
    const realpath = vi.fn(async (path: string) => path);
    const resolve = createCanonicalGitWatchRootResolver({
      execute,
      realpathProbe: asRealpathProbe(realpath),
    });

    await expect(resolve("/repo-alias")).resolves.toBe(expected);
    expect(realpath).toHaveBeenLastCalledWith(expected, expect.any(Object));
  });

  it("非 Git 目录、超时和取消都不产生可订阅根", async () => {
    const execute = vi.fn(async () => {
      throw new Error("not a repository");
    });
    const realpath = vi.fn(async (path: string) => path);
    const resolve = createCanonicalGitWatchRootResolver({
      execute,
      realpathProbe: asRealpathProbe(realpath),
    });

    await expect(resolve("/")).resolves.toBeNull();
    const controller = new AbortController();
    controller.abort();
    await expect(resolve("/repo", controller.signal)).resolves.toBeNull();
    expect(execute).toHaveBeenCalledOnce();
  });
});
