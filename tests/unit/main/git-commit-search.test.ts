import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchCommits } from "@main/services/git-commit-search.ts";
import { execGit, GitExecError } from "@main/services/git-exec.ts";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

type ExecOptions = { timeoutMs?: number } | undefined;

function realExec(
  args: readonly string[],
  cwd: string,
  options?: ExecOptions
): Promise<string> {
  return execGit(args, { cwd, ...options });
}

async function createRepository(userName = "Pier Test"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pier-commit-search-"));
  roots.push(root);
  await execGit(["init"], { cwd: root });
  await execGit(["config", "user.name", userName], { cwd: root });
  await execGit(["config", "user.email", "pier@example.invalid"], {
    cwd: root,
  });
  return root;
}

async function commitFile(
  root: string,
  path: string,
  content: string,
  message: string
): Promise<string> {
  await writeFile(join(root, path), content, "utf8");
  await execGit(["add", "-A", "--"], { cwd: root });
  await execGit(["commit", "-m", message], { cwd: root });
  return (await execGit(["rev-parse", "HEAD"], { cwd: root })).trim();
}

describe("git commit search query compiler", () => {
  it("形似 hash 的普通词未命中精确查后退化为消息搜索", async () => {
    const root = await createRepository();
    await commitFile(root, "a.ts", "base\n", "added feature");

    const result = await searchCommits(realExec, root, { query: "added" });

    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.message).toBe("added feature");
  });

  it("# 前缀强制精确 hash 查询,未命中返回空而不回退", async () => {
    const root = await createRepository();
    await commitFile(root, "a.ts", "base\n", "added feature");

    const result = await searchCommits(realExec, root, { query: "#deadbeef" });

    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(0);
  });

  it("@author 含正则元字符时可与消息词组合匹配", async () => {
    const root = await createRepository("John.Doe");
    await commitFile(root, "a.ts", "base\n", "fix bug");

    const result = await searchCommits(realExec, root, {
      query: "@john.doe fix",
    });

    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.author).toBe("John.Doe");
  });

  it("all: 仅作为整条查询前缀启用 --all", async () => {
    const root = await createRepository();
    await commitFile(root, "a.ts", "base\n", "base commit");
    await execGit(["switch", "-c", "feature"], { cwd: root });
    await commitFile(root, "b.ts", "feature\n", "feature-only work");
    await execGit(["switch", "-"], { cwd: root });

    const headOnly = await searchCommits(realExec, root, {
      query: "feature-only",
    });
    expect(headOnly.status).toBe("ok");
    expect(headOnly.items).toHaveLength(0);

    const allRefs = await searchCommits(realExec, root, {
      query: "all: feature-only",
    });
    expect(allRefs.status).toBe("ok");
    expect(allRefs.items).toHaveLength(1);

    // 非前缀位置的 "all:" 是普通消息词,不得开启 --all
    const midQuery = await searchCommits(realExec, root, {
      query: "feature-only all:",
    });
    expect(midQuery.status).toBe("ok");
    expect(midQuery.items).toHaveLength(0);
  });

  it("多个 ~token 只取第一个做 pickaxe,其余按消息词处理", async () => {
    const root = await createRepository();
    await commitFile(root, "a.ts", "alpha content\n", "beta change");
    await commitFile(root, "b.ts", "other\n", "unrelated");

    const result = await searchCommits(realExec, root, {
      query: "~alpha ~beta",
    });

    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.message).toBe("beta change");
  });

  it("SHA-256 仓库的完整 hash 可精确查", async (ctx) => {
    const root = await mkdtemp(join(tmpdir(), "pier-commit-search-sha256-"));
    roots.push(root);
    try {
      await execGit(["init", "--object-format=sha256"], { cwd: root });
    } catch {
      ctx.skip();
      return;
    }
    await execGit(["config", "user.name", "Pier Test"], { cwd: root });
    await execGit(["config", "user.email", "pier@example.invalid"], {
      cwd: root,
    });
    const hash = await commitFile(root, "a.ts", "base\n", "sha256 commit");
    expect(hash).toHaveLength(64);

    for (const query of [hash, `#${hash}`]) {
      const result = await searchCommits(realExec, root, { query });
      expect(result.status).toBe("ok");
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.hash).toBe(hash);
    }
  });

  it("since:/until: 关键字大小写不敏感且路由正确", async () => {
    const root = await createRepository();
    await commitFile(root, "a.ts", "base\n", "dated commit");

    // 误路由到 --until=2000-01-01 会排除刚创建的提交
    const since = await searchCommits(realExec, root, {
      query: "SINCE:2000-01-01 dated",
    });
    expect(since.status).toBe("ok");
    expect(since.items).toHaveLength(1);

    const until = await searchCommits(realExec, root, {
      query: "UNTIL:2000-01-01 dated",
    });
    expect(until.status).toBe("ok");
    expect(until.items).toHaveLength(0);
  });

  it("执行超时按 GitExecError.causeKind 归类为 timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-commit-search-timeout-"));
    roots.push(root);
    const timeoutExec = (
      args: readonly string[],
      cwd: string
    ): Promise<string> => {
      if (args[0] === "rev-parse") {
        return Promise.resolve(`${cwd}\n`);
      }
      return Promise.reject(
        new GitExecError({
          args,
          causeKind: "timeout",
          cwd,
          exitCode: null,
          message: "git 执行期限已到",
          stderr: "",
          stdout: "",
        })
      );
    };

    const result = await searchCommits(timeoutExec, root, { query: "slow" });

    expect(result.status).toBe("timeout");
    expect(result.items).toHaveLength(0);
  });
});
