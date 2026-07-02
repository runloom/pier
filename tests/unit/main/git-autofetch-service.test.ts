import {
  type CreateGitAutofetchServiceOptions,
  createCommonDirResolver,
  createGitAutofetchService,
} from "@main/services/git-autofetch-service.ts";
import { GitExecError, type GitExecOptions } from "@main/services/git-exec.ts";
import { describe, expect, it, vi } from "vitest";

type ExecGit = CreateGitAutofetchServiceOptions["execGit"];

function makeHarness(
  overrides: Partial<CreateGitAutofetchServiceOptions> = {}
) {
  let nowMs = 0;
  const fetched: string[] = [];
  const pulsed: string[] = [];
  const execGit = vi.fn((_args: readonly string[], opts: GitExecOptions) => {
    fetched.push(opts.cwd);
    return Promise.resolve("");
  }) satisfies ExecGit;
  const service = createGitAutofetchService({
    activeRoots: () => ["/repo/wt-a", "/repo/wt-b"],
    execGit,
    getConfig: () => ({ enabled: true, intervalMinutes: 5 }),
    isFocused: () => true,
    now: () => nowMs,
    pulse: (root: string) => pulsed.push(root),
    resolveCommonDir: async () => "/repo/.git",
    ...overrides,
  });
  return {
    advance: (ms: number) => {
      nowMs += ms;
    },
    execGit,
    fetched,
    pulsed,
    service,
  };
}

describe("git-autofetch-service", () => {
  it("同一 common dir 的多个 worktree 每轮只 fetch 一次，成功后 pulse 全部活跃 root", async () => {
    const h = makeHarness();
    h.advance(5 * 60_000);
    await h.service.tick();
    expect(h.fetched).toHaveLength(1);
    expect(h.execGit).toHaveBeenCalledWith(
      ["fetch", "--prune", "--quiet"],
      expect.objectContaining({ cwd: "/repo/wt-a", timeoutMs: 30_000 })
    );
    expect(h.pulsed).toEqual(["/repo/wt-a", "/repo/wt-b"]);
  });

  it("间隔未到不 fetch；到点才 fetch", async () => {
    const h = makeHarness();
    h.advance(4 * 60_000);
    await h.service.tick();
    expect(h.fetched).toHaveLength(0);
    h.advance(60_000);
    await h.service.tick();
    expect(h.fetched).toHaveLength(1);
  });

  it("未聚焦不 fetch", async () => {
    const h = makeHarness({ isFocused: () => false });
    h.advance(10 * 60_000);
    await h.service.tick();
    expect(h.fetched).toHaveLength(0);
  });

  it("preferences 关闭时不 fetch", async () => {
    const h = makeHarness({
      getConfig: () => ({ enabled: false, intervalMinutes: 5 }),
    });
    h.advance(10 * 60_000);
    await h.service.tick();
    expect(h.fetched).toHaveLength(0);
  });

  it("失败后指数退避：2 倍间隔内不重试，上限 8 倍", async () => {
    let fail = true;
    const h = makeHarness({
      execGit: vi.fn(() => {
        if (fail) {
          return Promise.reject(
            new GitExecError({
              args: ["fetch"],
              cwd: "/repo/wt-a",
              exitCode: 1,
              message: "network down",
              stderr: "could not resolve host",
              stdout: "",
            })
          );
        }
        return Promise.resolve("");
      }) satisfies ExecGit,
    });
    h.advance(5 * 60_000);
    await h.service.tick(); // 失败 #1
    h.advance(5 * 60_000);
    await h.service.tick(); // 2 倍退避窗口内，跳过
    expect(h.pulsed).toHaveLength(0);
    fail = false;
    h.advance(5 * 60_000); // 距上次尝试 10min = 2 倍间隔
    await h.service.tick();
    expect(h.pulsed).toEqual(["/repo/wt-a", "/repo/wt-b"]);
  });

  it("鉴权类失败进入 60min 冷却，冷却内不重试，过期后自动恢复", async () => {
    let fail = true;
    const authExecGit = vi.fn(() => {
      if (fail) {
        return Promise.reject(
          new GitExecError({
            args: ["fetch"],
            cwd: "/repo/wt-a",
            exitCode: 128,
            message: "auth",
            stderr: "fatal: could not read Username for 'https://github.com'",
            stdout: "",
          })
        );
      }
      return Promise.resolve("");
    }) satisfies ExecGit;
    const h = makeHarness({ execGit: authExecGit });
    h.advance(5 * 60_000);
    await h.service.tick(); // 命中鉴权失败，进入冷却
    h.advance(59 * 60_000); // 冷却期内（<60min）
    await h.service.tick();
    expect(h.pulsed).toHaveLength(0);
    expect(authExecGit).toHaveBeenCalledTimes(1);
    fail = false;
    h.advance(2 * 60_000); // 累计 61min，冷却到期，恢复尝试
    await h.service.tick();
    expect(h.pulsed).toEqual(["/repo/wt-a", "/repo/wt-b"]);
    expect(authExecGit).toHaveBeenCalledTimes(2);
  });

  it("裸 permission denied（本地文件问题）不触发鉴权冷却，走普通退避", async () => {
    const localExecGit = vi.fn(() =>
      Promise.reject(
        new GitExecError({
          args: ["fetch"],
          cwd: "/repo/wt-a",
          exitCode: 128,
          message: "local fs error",
          stderr: "error: cannot open '.git/FETCH_HEAD': Permission denied",
          stdout: "",
        })
      )
    ) satisfies ExecGit;
    const h = makeHarness({ execGit: localExecGit });
    h.advance(5 * 60_000);
    await h.service.tick(); // 失败 #1，走普通退避而非冷却
    h.advance(5 * 60_000); // 2 倍退避窗口内，跳过
    await h.service.tick();
    expect(localExecGit).toHaveBeenCalledTimes(1);
    h.advance(5 * 60_000); // 累计 10min = 2 倍间隔，恢复尝试（未被冷却拦住）
    await h.service.tick();
    expect(localExecGit).toHaveBeenCalledTimes(2);
  });

  it("onFocusGained 触发到期补跑", async () => {
    let focused = false;
    const h = makeHarness({ isFocused: () => focused });
    h.advance(10 * 60_000);
    await h.service.tick();
    expect(h.fetched).toHaveLength(0);
    focused = true;
    h.service.onFocusGained();
    await vi.waitFor(() => {
      expect(h.fetched).toHaveLength(1);
    });
  });

  it("B1: commonDir 解析瞬时失败不缓存，下一轮自动重试", async () => {
    const execGit = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(
        "/repo/.git\n"
      ) satisfies CreateGitAutofetchServiceOptions["execGit"];
    const resolve = createCommonDirResolver(execGit as never);
    const first = await resolve("/repo/wt-a");
    expect(first).toBeNull();
    const second = await resolve("/repo/wt-a");
    expect(second).toBe("/repo/.git");
    expect(execGit).toHaveBeenCalledTimes(2);
  });

  it("B2: dispose 后 tick/onFocusGained 不再执行 execGit", async () => {
    const h = makeHarness();
    h.service.dispose();
    h.advance(10 * 60_000);
    await h.service.tick();
    h.service.onFocusGained();
    await Promise.resolve();
    expect(h.execGit).not.toHaveBeenCalled();
  });

  it("B2: start() 在 dispose 后拒绝重启心跳", async () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness();
      h.service.dispose();
      h.service.start();
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(h.execGit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("B4: focusCatchup 距上次成功超过间隔且距上次尝试超过地板时补跑", async () => {
    let fail = true;
    const execGit = vi.fn(() => {
      if (fail) {
        return Promise.reject(
          new GitExecError({
            args: ["fetch"],
            cwd: "/repo/wt-a",
            exitCode: 1,
            message: "network down",
            stderr: "could not resolve host",
            stdout: "",
          })
        );
      }
      return Promise.resolve("");
    }) satisfies ExecGit;
    const h = makeHarness({ execGit });
    fail = false;
    // t=0（相对起点）成功，建立 lastSuccessAt 基准
    h.advance(5 * 60_000);
    await h.service.tick();
    expect(h.pulsed).toEqual(["/repo/wt-a", "/repo/wt-b"]);
    h.pulsed.length = 0;
    // +5min 失败（backoff=2）
    fail = true;
    h.advance(5 * 60_000);
    await h.service.tick();
    expect(h.pulsed).toHaveLength(0);
    // +6min（距上次成功）focusCatchup：距上次成功 6min >= 5min 间隔，距上次尝试 1min >= 60s 地板 → 执行
    fail = false;
    h.advance(60_000);
    await h.service.tick({ focusCatchup: true });
    expect(h.pulsed).toEqual(["/repo/wt-a", "/repo/wt-b"]);
  });

  it("B4: focusCatchup 距上次失败尝试不足地板时不补跑", async () => {
    const execGit = vi.fn(() =>
      Promise.reject(
        new GitExecError({
          args: ["fetch"],
          cwd: "/repo/wt-a",
          exitCode: 1,
          message: "network down",
          stderr: "could not resolve host",
          stdout: "",
        })
      )
    ) satisfies ExecGit;
    const h = makeHarness({ execGit });
    h.advance(5 * 60_000);
    await h.service.tick(); // t=5min 失败 #1（无成功记录）
    expect(execGit).toHaveBeenCalledTimes(1);
    // t=5min30s focusCatchup：距上次尝试仅 30s < 60s 地板 → 不执行
    h.advance(30_000);
    await h.service.tick({ focusCatchup: true });
    expect(execGit).toHaveBeenCalledTimes(1);
  });

  it("B5: 第一个 root 是死路径时回退到下一个仍能 fetch 成功", async () => {
    const execGit = vi.fn((_args: readonly string[], opts: GitExecOptions) => {
      if (opts.cwd === "/repo/dead-a") {
        return Promise.reject(
          new GitExecError({
            args: ["fetch"],
            cwd: "/repo/dead-a",
            exitCode: 128,
            message: "not a repo",
            stderr:
              "fatal: not a git repository (or any of the parent directories): .git",
            stdout: "",
          })
        );
      }
      return Promise.resolve("");
    }) satisfies ExecGit;
    const h = makeHarness({
      activeRoots: () => ["/repo/dead-a", "/repo/alive-b"],
      execGit,
    });
    h.advance(5 * 60_000);
    await h.service.tick();
    expect(h.pulsed).toEqual(["/repo/dead-a", "/repo/alive-b"]);
    expect(execGit).toHaveBeenCalledTimes(2);
  });
});
