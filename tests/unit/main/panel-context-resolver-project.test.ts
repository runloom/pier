import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Electron app.getPath 需要 mock 才能触发 upsertProjectFromPath 内部的
// debouncedJsonStore 初始化；否则 panel-context-resolver 的 .catch(() => null)
// 会静默兜底, 新加的 projectId / projectRootPath 字段永远不出现在 context 里,
// 测试对 D 的核心行为完全盲区（review Commit D P1 指出的假绿风险）。
const userDataPath = { current: "/unused" };

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => userDataPath.current),
  },
}));

const execFileAsync = promisify(execFile);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

describe("resolvePanelContextForPath — Project 集成", () => {
  let userDataDir: string;
  const cleanupDirs: string[] = [];

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), "pier-resolver-userdata-"));
    userDataPath.current = userDataDir;
    // 每个 test 拿到全新 module state (含全新 project-store singleton)
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(userDataDir, { force: true, recursive: true });
    await Promise.all(
      cleanupDirs
        .splice(0)
        .map((dir) => rm(dir, { force: true, recursive: true }))
    );
  });

  it("resolver 在 git repo 里派生出 projectId (uuid) + projectRootPath (repo 路径)", async () => {
    const { resolvePanelContextForPath } = await import(
      "@main/services/panel-context-resolver.ts"
    );
    const repo = await initRepo("pier-resolver-repo-");
    cleanupDirs.push(repo);
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({ name: "resolver-test-pkg" })
    );

    const ctx = await resolvePanelContextForPath(repo);
    expect(ctx.projectId).toMatch(UUID_RE);
    expect(ctx.projectRootPath).toBe(repo);
    // 老字段仍存在 (backward-compat 期)
    expect(ctx.projectRootPath).toBe(repo);
  });

  it("resolver 与 project-store 双向一致：projectId ↔ project-store.readProjectById", async () => {
    const { resolvePanelContextForPath } = await import(
      "@main/services/panel-context-resolver.ts"
    );
    const { readProjectById } = await import("@main/state/project-store.ts");
    const repo = await initRepo("pier-resolver-consistency-");
    cleanupDirs.push(repo);
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({ name: "consistency-pkg" })
    );

    const ctx = await resolvePanelContextForPath(repo);
    const project = await readProjectById(ctx.projectId ?? "");
    expect(project?.rootPath).toBe(repo);
    expect(project?.name).toBe("consistency-pkg");
  });

  it("resolver 幂等：同一 path 二次调用返回同 projectId", async () => {
    const { resolvePanelContextForPath } = await import(
      "@main/services/panel-context-resolver.ts"
    );
    const repo = await initRepo("pier-resolver-idempotent-");
    cleanupDirs.push(repo);
    const c1 = await resolvePanelContextForPath(repo);
    const c2 = await resolvePanelContextForPath(repo);
    expect(c1.projectId).toBe(c2.projectId);
    expect(c1.projectId).toMatch(UUID_RE);
  });

  it("非 git 目录（无 gitRoot）：projectRoot fallback 到 cwd, projectId 仍派生", async () => {
    const { resolvePanelContextForPath } = await import(
      "@main/services/panel-context-resolver.ts"
    );
    const plain = await makeTempDir("pier-resolver-plain-");
    cleanupDirs.push(plain);
    await mkdir(join(plain, "src"));
    const ctx = await resolvePanelContextForPath(plain);
    expect(ctx.projectRootPath).toBe(plain);
    expect(ctx.projectRootPath).toBe(plain);
    expect(ctx.projectId).toMatch(UUID_RE);
  });
});
