import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  resolveFileSaveTargetForPath,
  resolvePanelContextForPath,
} from "@main/services/panel-context-resolver.ts";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const NOW = 1_772_000_000_000;

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const canonical = await realpath(dir);
  tempDirs.push(canonical);
  return canonical;
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], { cwd });
  return stdout.trim();
}

async function initRepo(): Promise<string> {
  const repo = await makeTempDir("pier-panel-context-repo-");
  await git(repo, ["init"]);
  await git(repo, ["config", "user.email", "pier@example.com"]);
  await git(repo, ["config", "user.name", "Pier Test"]);
  await writeFile(join(repo, "README.md"), "# Pier\n");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "init"]);
  return repo;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("resolvePanelContextForPath", () => {
  it("resolves a file path to cwd, project root, git root, branch, and head", async () => {
    const repo = await initRepo();
    const srcDir = join(repo, "src");
    const filePath = join(srcDir, "index.ts");
    await mkdir(srcDir);
    await writeFile(filePath, "export const value = 1;\n");
    const branch = await git(repo, ["branch", "--show-current"]);
    const head = await git(repo, ["rev-parse", "--verify", "HEAD"]);
    const gitCommonDir = await git(repo, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);

    await expect(
      resolvePanelContextForPath(filePath, { now: () => NOW })
    ).resolves.toMatchObject({
      branch,
      cwd: dirname(filePath),
      gitCommonDir,
      gitRoot: repo,
      head,
      openedPath: filePath,
      projectRootPath: repo,
      source: "command",
      updatedAt: NOW,
      worktreeRoot: repo,
      worktreeKey: repo,
      worktreeSupported: true,
    });
  });

  it("resolves linked git worktrees without confusing record identity", async () => {
    const repo = await initRepo();
    const worktree = await makeTempDir("pier-panel-context-worktree-");
    await rm(worktree, { force: true, recursive: true });
    await git(repo, [
      "worktree",
      "add",
      "-b",
      "feature/panel-context",
      worktree,
    ]);
    const gitCommonDir = await git(worktree, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);

    await expect(
      resolvePanelContextForPath(worktree, { now: () => NOW })
    ).resolves.toMatchObject({
      branch: "feature/panel-context",
      cwd: worktree,
      gitCommonDir,
      gitRoot: worktree,
      openedPath: worktree,
      projectRootPath: worktree,
      source: "command",
      updatedAt: NOW,
      worktreeRoot: worktree,
      worktreeKey: worktree,
      worktreeSupported: true,
    });
  });

  it("falls back to a path-scoped project context outside git", async () => {
    const project = await makeTempDir("pier-panel-context-plain-");

    await expect(
      resolvePanelContextForPath(project, { now: () => NOW })
    ).resolves.toMatchObject({
      cwd: project,
      openedPath: project,
      projectRootPath: project,
      source: "command",
      updatedAt: NOW,
      worktreeKey: project,
    });
  });

  it("still returns a usable context when git probing fails", async () => {
    const project = await makeTempDir("pier-panel-context-git-fail-");

    const context = await resolvePanelContextForPath(project, {
      execGit: () => {
        throw new Error("git unavailable");
      },
      now: () => NOW,
    });

    expect(context).toMatchObject({
      cwd: project,
      openedPath: project,
      projectRootPath: project,
      source: "command",
      updatedAt: NOW,
      worktreeKey: project,
    });
    expect(context.gitRoot).toBeUndefined();
    expect(context.worktreeRoot).toBeUndefined();
  });

  it("marks git contexts unsupported when git worktree probing fails", async () => {
    const project = await makeTempDir("pier-panel-context-worktree-fail-");

    const context = await resolvePanelContextForPath(project, {
      execGit: (args) => {
        const command = args.join(" ");
        if (command === "rev-parse --show-toplevel") {
          return Promise.resolve(project);
        }
        if (command === "rev-parse --path-format=absolute --git-common-dir") {
          return Promise.resolve(project);
        }
        if (command === "branch --show-current") {
          return Promise.resolve("main");
        }
        if (command === "rev-parse --verify HEAD") {
          return Promise.resolve("abc123");
        }
        if (command === "worktree list --porcelain -z") {
          throw new Error("git worktree unsupported");
        }
        throw new Error(`unexpected git command: ${command}`);
      },
      now: () => NOW,
    });

    expect(context).toMatchObject({
      cwd: project,
      gitRoot: project,
      openedPath: project,
      projectRootPath: project,
      updatedAt: NOW,
      worktreeRoot: project,
      worktreeSupported: false,
    });
  });
});

describe("resolveFileSaveTargetForPath", () => {
  it("preserves the current context for a target inside the same Git root", async () => {
    const project = await initRepo();
    const context = await resolvePanelContextForPath(project, {
      now: () => NOW,
    });

    await expect(
      resolveFileSaveTargetForPath(join(project, "src", "notes.md"), context)
    ).resolves.toEqual({
      context,
      path: join("src", "notes.md"),
      root: project,
    });
  });

  it("uses a different Git root as the recoverable anchor outside the current project", async () => {
    const sourceProject = await initRepo();
    const targetProject = await initRepo();
    const sourceContext = await resolvePanelContextForPath(sourceProject, {
      now: () => NOW,
    });
    const targetPath = join(targetProject, "notes.md");

    const target = await resolveFileSaveTargetForPath(
      targetPath,
      sourceContext,
      { now: () => NOW }
    );

    expect(target).toMatchObject({
      context: {
        gitRoot: targetProject,
        openedPath: targetPath,
        projectRootPath: targetProject,
        source: "panel",
      },
      path: "notes.md",
      root: targetProject,
    });
  });

  it("anchors a new target outside the project to its parent directory", async () => {
    const project = await makeTempDir("pier-save-target-source-");
    const outside = await makeTempDir("pier-save-target-outside-");
    const sourceContext = await resolvePanelContextForPath(project, {
      now: () => NOW,
    });
    const targetPath = join(outside, "notes.md");

    const target = await resolveFileSaveTargetForPath(
      targetPath,
      sourceContext,
      {
        execGit: () => {
          throw new Error("not a git repository");
        },
        now: () => NOW,
      }
    );

    expect(target).toMatchObject({
      context: {
        cwd: outside,
        openedPath: targetPath,
        projectRootPath: outside,
        source: "panel",
      },
      path: "notes.md",
      root: outside,
    });
  });

  it("rejects non-absolute save targets", async () => {
    const project = await makeTempDir("pier-save-target-invalid-");
    const context = await resolvePanelContextForPath(project);

    await expect(
      resolveFileSaveTargetForPath("notes.md", context)
    ).rejects.toThrow("absolute path");
  });
});
