import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createWorktreeService,
  parseGitWorktreeListPorcelainZ,
} from "@main/services/worktree-service.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);
type WorktreeServiceOptionsWithPreferences = NonNullable<
  Parameters<typeof createWorktreeService>[0]
> & {
  readPreferences: () => Promise<{ worktreeRootPath: string }>;
};
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

async function initRepo(): Promise<string> {
  const repo = await makeTempDir("pier-worktree-repo-");
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "pier@example.com"]);
  await git(repo, ["config", "user.name", "Pier Test"]);
  await writeFile(join(repo, "README.md"), "pier\n");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "init"]);
  return repo;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("parseGitWorktreeListPorcelainZ", () => {
  it("解析 git worktree list --porcelain -z 输出", () => {
    const output = [
      "worktree /repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /repo/.worktrees/feature-a",
      "HEAD def456",
      "branch refs/heads/feature/a",
      "locked waiting for review",
      "prunable gitdir file points to missing location",
      "",
      "worktree /repo/.worktrees/detached",
      "HEAD fedcba",
      "detached",
      "",
    ].join("\0");

    expect(
      parseGitWorktreeListPorcelainZ(output, "/repo/.worktrees/feature-a")
    ).toEqual([
      {
        bare: false,
        branch: "main",
        detached: false,
        head: "abc123",
        isCurrent: false,
        isMain: true,
        locked: false,
        lockedReason: null,
        path: "/repo",
        prunable: false,
        prunableReason: null,
      },
      {
        bare: false,
        branch: "feature/a",
        detached: false,
        head: "def456",
        isCurrent: true,
        isMain: false,
        locked: true,
        lockedReason: "waiting for review",
        path: "/repo/.worktrees/feature-a",
        prunable: true,
        prunableReason: "gitdir file points to missing location",
      },
      {
        bare: false,
        branch: null,
        detached: true,
        head: "fedcba",
        isCurrent: false,
        isMain: false,
        locked: false,
        lockedReason: null,
        path: "/repo/.worktrees/detached",
        prunable: false,
        prunableReason: null,
      },
    ]);
  });
});

describe("createWorktreeService", () => {
  it("检查普通 Git 仓库支持 worktree", async () => {
    const repo = await initRepo();
    const realRepo = await realpath(repo);
    const service = createWorktreeService();

    await expect(service.check({ path: repo })).resolves.toMatchObject({
      currentPath: realRepo,
      mainPath: realRepo,
      path: realRepo,
      status: "supported",
    });
  });

  it("检查非 Git 目录时返回禁用原因", async () => {
    const dir = await makeTempDir("pier-worktree-capability-");
    const realDir = await realpath(dir);
    const service = createWorktreeService();

    await expect(service.check({ path: dir })).resolves.toEqual({
      path: realDir,
      reason: "not_git_repo",
      status: "unsupported",
    });
  });

  it("列出普通 Git 仓库", async () => {
    const repo = await initRepo();
    const realRepo = await realpath(repo);
    const service = createWorktreeService();

    await expect(service.list({ path: repo })).resolves.toMatchObject({
      mainPath: realRepo,
      path: realRepo,
      status: "available",
      worktrees: [
        {
          branch: "main",
          isCurrent: true,
          isMain: true,
          path: realRepo,
        },
      ],
    });
  });

  it("从 linked worktree 里列出同仓库所有 worktree", async () => {
    const repo = await initRepo();
    const root = await makeTempDir("pier-worktree-linked-");
    const linked = join(root, "feature-a");
    await git(repo, ["worktree", "add", "-b", "feature-a", linked]);
    const realRepo = await realpath(repo);
    const realLinked = await realpath(linked);
    const service = createWorktreeService();

    const result = await service.list({ path: linked });

    if (result.status !== "available") {
      throw new Error(`expected available worktree list, got ${result.reason}`);
    }
    expect(result.mainPath).toBe(realRepo);
    expect(result.currentPath).toBe(realLinked);
    expect(result.worktrees.map((item) => item.path)).toEqual([
      realRepo,
      realLinked,
    ]);
    expect(result.worktrees[0]).toMatchObject({
      branch: "main",
      isCurrent: false,
      isMain: true,
    });
    expect(result.worktrees[1]).toMatchObject({
      branch: "feature-a",
      isCurrent: true,
      isMain: false,
    });
  });

  it("非 Git 目录返回 unavailable 而不是抛错", async () => {
    const dir = await makeTempDir("pier-worktree-not-git-");
    const realDir = await realpath(dir);
    const service = createWorktreeService();

    await expect(service.list({ path: dir })).resolves.toEqual({
      path: realDir,
      reason: "not_git_repo",
      status: "unavailable",
      worktrees: [],
    });
  });

  it("create 默认使用 main worktree 的 sibling .worktree 目录构造 git 参数", async () => {
    const calls: Array<{ args: readonly string[]; cwd: string }> = [];
    const mkdirCalls: string[] = [];
    let createdPath: string | null = null;
    const service = createWorktreeService({
      execGit: (args, cwd) => {
        calls.push({ args, cwd });
        if (args[0] === "rev-parse" && args.includes("--show-toplevel")) {
          return Promise.resolve("/repo\n");
        }
        if (args[0] === "worktree" && args[1] === "list") {
          const output = createdPath
            ? [
                "worktree /repo",
                "HEAD abc123",
                "branch refs/heads/main",
                "",
                `worktree ${createdPath}`,
                "HEAD def456",
                "branch refs/heads/feature/a",
                "",
              ]
            : ["worktree /repo", "HEAD abc123", "branch refs/heads/main", ""];
          return Promise.resolve(output.join("\0"));
        }
        if (args[0] === "worktree" && args[1] === "add") {
          createdPath = String(args[4]);
          return Promise.resolve("");
        }
        return Promise.resolve("");
      },
      mkdir: (path) => {
        mkdirCalls.push(path);
        return Promise.resolve(undefined);
      },
      realpath: (path) => Promise.resolve(path),
    });

    const result = await service.create({
      base: "origin/main",
      branch: "feature/a",
      name: "feature-a",
      path: "/repo",
    });

    expect(result).toMatchObject({
      created: {
        branch: "feature/a",
        path: "/repo.worktree/feature-a",
      },
      targetPath: "/repo.worktree/feature-a",
    });
    expect(mkdirCalls).toEqual(["/repo.worktree"]);
    expect(calls).toContainEqual({
      args: [
        "worktree",
        "add",
        "-b",
        "feature/a",
        "/repo.worktree/feature-a",
        "origin/main",
      ],
      cwd: "/repo",
    });
  });

  it("create 使用配置的绝对 worktree 根目录构造 git 参数", async () => {
    const calls: Array<{ args: readonly string[]; cwd: string }> = [];
    const mkdirCalls: string[] = [];
    let createdPath: string | null = null;
    const service = createWorktreeService({
      execGit: (args, cwd) => {
        calls.push({ args, cwd });
        if (args[0] === "rev-parse" && args.includes("--show-toplevel")) {
          return Promise.resolve("/repo\n");
        }
        if (args[0] === "worktree" && args[1] === "list") {
          const output = createdPath
            ? [
                "worktree /repo",
                "HEAD abc123",
                "branch refs/heads/main",
                "",
                `worktree ${createdPath}`,
                "HEAD def456",
                "branch refs/heads/feature/a",
                "",
              ]
            : ["worktree /repo", "HEAD abc123", "branch refs/heads/main", ""];
          return Promise.resolve(output.join("\0"));
        }
        if (args[0] === "worktree" && args[1] === "add") {
          createdPath = String(args[4]);
          return Promise.resolve("");
        }
        return Promise.resolve("");
      },
      mkdir: (path) => {
        mkdirCalls.push(path);
        return Promise.resolve(undefined);
      },
      readPreferences: async () => ({ worktreeRootPath: "/custom/worktrees" }),
      realpath: (path) => Promise.resolve(path),
    } satisfies WorktreeServiceOptionsWithPreferences);

    const result = await service.create({
      branch: "feature/a",
      name: "feature-a",
      path: "/repo",
    });

    expect(result).toMatchObject({
      created: {
        branch: "feature/a",
        path: "/custom/worktrees/feature-a",
      },
      targetPath: "/custom/worktrees/feature-a",
    });
    expect(mkdirCalls).toEqual(["/custom/worktrees"]);
    expect(calls).toContainEqual({
      args: [
        "worktree",
        "add",
        "-b",
        "feature/a",
        "/custom/worktrees/feature-a",
      ],
      cwd: "/repo",
    });
  });

  it("create 在执行 git worktree add 前校验 branch 名称", async () => {
    const calls: Array<{ args: readonly string[]; cwd: string }> = [];
    const service = createWorktreeService({
      execGit: (args, cwd) => {
        calls.push({ args, cwd });
        if (args[0] === "rev-parse" && args.includes("--show-toplevel")) {
          return Promise.resolve("/repo\n");
        }
        if (args[0] === "worktree" && args[1] === "list") {
          return Promise.resolve(
            [
              "worktree /repo",
              "HEAD abc123",
              "branch refs/heads/main",
              "",
            ].join("\0")
          );
        }
        if (args[0] === "check-ref-format") {
          return Promise.reject(new Error("invalid branch"));
        }
        return Promise.resolve("");
      },
      realpath: (path) => Promise.resolve(path),
    });

    await expect(
      service.create({
        branch: "bad branch",
        name: "feature-a",
        path: "/repo",
      })
    ).rejects.toMatchObject({
      reason: "invalid_branch",
    });

    expect(
      calls.some(
        (call) => call.args[0] === "worktree" && call.args[1] === "add"
      )
    ).toBe(false);
  });

  it("create 在校验 branch 前先确认 path 是可用 Git 仓库", async () => {
    const calls: Array<{ args: readonly string[]; cwd: string }> = [];
    const service = createWorktreeService({
      execGit: (args, cwd) => {
        calls.push({ args, cwd });
        if (args[0] === "rev-parse") {
          return Promise.reject(new Error("not a git repository"));
        }
        return Promise.resolve("");
      },
      realpath: (path) => Promise.resolve(path),
    });

    await expect(
      service.create({
        branch: "feature/a",
        name: "feature-a",
        path: "/missing-repo",
      })
    ).rejects.toMatchObject({
      reason: "not_git_repo",
    });

    expect(calls.map((call) => call.args[0])).toEqual(["rev-parse"]);
  });

  it("remove 使用 git worktree remove 安全移除 Pier 管理的 linked worktree", async () => {
    const repo = await initRepo();
    const linked = join(repo, ".worktrees", "feature-a");
    await git(repo, ["worktree", "add", "-b", "feature-a", linked]);
    const realRepo = await realpath(repo);
    const realLinked = await realpath(linked);
    const service = createWorktreeService();

    const result = await service.remove({
      currentPath: repo,
      path: linked,
    });

    expect(result).toMatchObject({
      removedPath: realLinked,
      worktrees: [
        {
          isMain: true,
          path: realRepo,
        },
      ],
    });
  });

  it("remove 使用 git worktree remove 安全移除默认 sibling .worktree 根下的 linked worktree", async () => {
    const repo = await initRepo();
    const linkedRoot = `${repo}.worktree`;
    tempDirs.push(linkedRoot);
    const linked = join(linkedRoot, "feature-a");
    await git(repo, ["worktree", "add", "-b", "feature-a", linked]);
    const realRepo = await realpath(repo);
    const realLinked = await realpath(linked);
    const service = createWorktreeService();

    const result = await service.remove({
      currentPath: repo,
      path: linked,
    });

    expect(result).toMatchObject({
      removedPath: realLinked,
      worktrees: [
        {
          isMain: true,
          path: realRepo,
        },
      ],
    });
  });

  it("remove 使用 git worktree remove 安全移除配置的绝对 worktree 根下的 linked worktree", async () => {
    const repo = await initRepo();
    const linkedRoot = await makeTempDir("pier-worktree-configured-");
    const linked = join(linkedRoot, "feature-a");
    await git(repo, ["worktree", "add", "-b", "feature-a", linked]);
    const realRepo = await realpath(repo);
    const realLinked = await realpath(linked);
    const service = createWorktreeService({
      readPreferences: async () => ({ worktreeRootPath: linkedRoot }),
    } satisfies WorktreeServiceOptionsWithPreferences);

    const result = await service.remove({
      currentPath: repo,
      path: linked,
    });

    expect(result).toMatchObject({
      removedPath: realLinked,
      worktrees: [
        {
          isMain: true,
          path: realRepo,
        },
      ],
    });
  });

  it("remove 拒绝移除 main worktree", async () => {
    const repo = await initRepo();
    const service = createWorktreeService();

    await expect(service.remove({ path: repo })).rejects.toMatchObject({
      reason: "main_worktree",
    });
  });

  it("remove 在提供 currentPath 时拒绝移除当前 worktree", async () => {
    const repo = await initRepo();
    const linked = join(repo, ".worktrees", "feature-a");
    await git(repo, ["worktree", "add", "-b", "feature-a", linked]);
    const service = createWorktreeService();

    await expect(
      service.remove({
        currentPath: linked,
        path: linked,
      })
    ).rejects.toMatchObject({
      reason: "current_worktree",
    });
  });

  // C5: 写操作（worktree add/remove）应传 60s 超时，避免大仓库继承 git-exec 默认 10s 失败
  it("create 给 worktree add 传 timeoutMs: 60_000", async () => {
    const addCallOptions: Array<{ timeoutMs?: number } | undefined> = [];
    let createdPath: string | null = null;
    const service = createWorktreeService({
      execGit: (args, cwd, options) => {
        if (args[0] === "worktree" && args[1] === "add") {
          addCallOptions.push(options);
          createdPath = String(args[4]);
          return Promise.resolve("");
        }
        if (args[0] === "rev-parse" && args.includes("--show-toplevel")) {
          return Promise.resolve(`${cwd}\n`);
        }
        if (args[0] === "worktree" && args[1] === "list") {
          const output = createdPath
            ? [
                "worktree /repo",
                "HEAD abc123",
                "branch refs/heads/main",
                "",
                `worktree ${createdPath}`,
                "HEAD def456",
                "branch refs/heads/feature/a",
                "",
              ]
            : ["worktree /repo", "HEAD abc123", "branch refs/heads/main", ""];
          return Promise.resolve(output.join("\0"));
        }
        return Promise.resolve("");
      },
      mkdir: () => Promise.resolve(undefined),
      realpath: (path) => Promise.resolve(path),
    });

    await service.create({
      branch: "feature/a",
      name: "feature-a",
      path: "/repo",
    });

    expect(addCallOptions[0]?.timeoutMs).toBe(60_000);
  });

  // S1: list 中 worktree list 失败时 console.warn 透传 stderr/exitCode（避免迁移后信息静默丢失）
  it("list 失败时 console.warn 透传错误信息", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // suppress
    });
    const service = createWorktreeService({
      execGit: (args) => {
        if (args[0] === "rev-parse") {
          return Promise.resolve("/repo\n");
        }
        if (args[0] === "worktree" && args[1] === "list") {
          return Promise.reject(new Error("simulated git stderr"));
        }
        return Promise.resolve("");
      },
      realpath: (path) => Promise.resolve(path),
    });

    await service.list({ path: "/repo" });

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("remove 拒绝移除 main .worktrees 目录外的 linked worktree", async () => {
    const repo = await initRepo();
    const root = await makeTempDir("pier-worktree-unmanaged-");
    const linked = join(root, "feature-a");
    await git(repo, ["worktree", "add", "-b", "feature-a", linked]);
    const service = createWorktreeService();

    await expect(
      service.remove({
        currentPath: repo,
        path: linked,
      })
    ).rejects.toMatchObject({
      reason: "unsafe_path",
    });
  });
});
