import {
  type CreateGitAutofetchServiceOptions,
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

  it("鉴权类失败本会话停用该仓库", async () => {
    const authExecGit = vi.fn(() =>
      Promise.reject(
        new GitExecError({
          args: ["fetch"],
          cwd: "/repo/wt-a",
          exitCode: 128,
          message: "auth",
          stderr: "fatal: could not read Username for 'https://github.com'",
          stdout: "",
        })
      )
    ) satisfies ExecGit;
    const h = makeHarness({ execGit: authExecGit });
    h.advance(5 * 60_000);
    await h.service.tick();
    h.advance(100 * 60_000);
    await h.service.tick();
    expect(h.pulsed).toHaveLength(0);
    // execGit 只被调过一次（停用后不再尝试）
    expect(authExecGit).toHaveBeenCalledTimes(1);
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
});
