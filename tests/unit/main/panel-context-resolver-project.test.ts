import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return realpath(dir);
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], { cwd });
  return stdout.trim();
}

async function initRepo(prefix: string): Promise<string> {
  const repo = await makeTempDir(prefix);
  await git(repo, ["init"]);
  await git(repo, ["config", "user.email", "pier@example.com"]);
  await git(repo, ["config", "user.name", "Pier Test"]);
  await writeFile(join(repo, "README.md"), "# Pier\n");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "init"]);
  return repo;
}

describe("resolvePanelContextForPath — 路径锚点上下文", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanupDirs
        .splice(0)
        .map((dir) => rm(dir, { force: true, recursive: true }))
    );
  });

  it("Git 目录以仓库根目录作为 projectRootPath", async () => {
    const { resolvePanelContextForPath } = await import(
      "@main/services/panel-context-resolver.ts"
    );
    const repo = await initRepo("pier-resolver-repo-");
    cleanupDirs.push(repo);

    const ctx = await resolvePanelContextForPath(repo);

    expect(ctx.projectRootPath).toBe(repo);
    expect(ctx.gitRoot).toBe(repo);
    expect(ctx.worktreeRoot).toBe(repo);
    expect(ctx.worktreeKey).toBe(repo);
    expect(ctx).not.toHaveProperty("projectId");
  });

  it("同一路径重复解析得到稳定 contextId", async () => {
    const { resolvePanelContextForPath } = await import(
      "@main/services/panel-context-resolver.ts"
    );
    const repo = await initRepo("pier-resolver-idempotent-");
    cleanupDirs.push(repo);

    const first = await resolvePanelContextForPath(repo);
    const second = await resolvePanelContextForPath(repo);

    expect(first.contextId).toBe(second.contextId);
    expect(first.projectRootPath).toBe(repo);
    expect(second.projectRootPath).toBe(repo);
  });

  it("非 Git 目录以 cwd 作为 projectRootPath", async () => {
    const { resolvePanelContextForPath } = await import(
      "@main/services/panel-context-resolver.ts"
    );
    const plain = await makeTempDir("pier-resolver-plain-");
    cleanupDirs.push(plain);
    await mkdir(join(plain, "src"));

    const ctx = await resolvePanelContextForPath(plain);

    expect(ctx.cwd).toBe(plain);
    expect(ctx.projectRootPath).toBe(plain);
    expect(ctx.gitRoot).toBeUndefined();
    expect(ctx).not.toHaveProperty("projectId");
  });
});
