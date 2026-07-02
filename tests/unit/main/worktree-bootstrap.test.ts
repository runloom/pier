import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  copyWorktreeIncludes,
  matchesCopyPattern,
} from "@main/services/worktree-bootstrap.ts";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
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

async function initRepoWithIgnoredFiles(): Promise<string> {
  const repo = await makeTempDir("pier-bootstrap-repo-");
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "pier@example.com"]);
  await git(repo, ["config", "user.name", "Pier Test"]);
  await writeFile(
    join(repo, ".gitignore"),
    ".env*\n*.local\nnode_modules/\n.claude/settings.local.json\n"
  );
  await git(repo, ["add", ".gitignore"]);
  await git(repo, ["commit", "-m", "init"]);
  await writeFile(join(repo, ".env"), "SECRET=1\n");
  await writeFile(join(repo, ".env.development"), "DEV=1\n");
  await writeFile(join(repo, "settings.local"), "x\n");
  await mkdir(join(repo, ".claude"), { recursive: true });
  await writeFile(join(repo, ".claude", "settings.local.json"), "{}\n");
  await mkdir(join(repo, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(repo, "node_modules", "pkg", "index.js"), "");
  return repo;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("matchesCopyPattern", () => {
  it("无 / 的 pattern 匹配 basename;带 / 的匹配相对路径", () => {
    expect(matchesCopyPattern(".env", ".env*")).toBe(true);
    expect(matchesCopyPattern("packages/app/.env.local", ".env*")).toBe(true);
    expect(matchesCopyPattern("a.local", "*.local")).toBe(true);
    expect(
      matchesCopyPattern(
        ".claude/settings.local.json",
        ".claude/settings.local.json"
      )
    ).toBe(true);
    expect(matchesCopyPattern("src/env.ts", ".env*")).toBe(false);
  });
});

describe("copyWorktreeIncludes", () => {
  it("复制命中 pattern 的 ignored 文件,跳过 node_modules", async () => {
    const repo = await initRepoWithIgnoredFiles();
    const target = join(repo, ".worktrees", "wt-a");
    await git(repo, ["worktree", "add", "-b", "wt/a", target]);

    const result = await copyWorktreeIncludes({
      mainPath: repo,
      patterns: [".env*", "*.local", ".claude/settings.local.json"],
      targetPath: target,
    });

    expect(result.copied.toSorted()).toEqual([
      ".claude/settings.local.json",
      ".env",
      ".env.development",
      "settings.local",
    ]);
    await access(join(target, ".env"));
    await access(join(target, ".claude", "settings.local.json"));
    await expect(access(join(target, "node_modules"))).rejects.toThrow();
  });

  it("patterns 为空时不做任何事", async () => {
    const repo = await initRepoWithIgnoredFiles();
    const target = join(repo, ".worktrees", "wt-b");
    await git(repo, ["worktree", "add", "-b", "wt/b", target]);
    const result = await copyWorktreeIncludes({
      mainPath: repo,
      patterns: [],
      targetPath: target,
    });
    expect(result).toEqual({ copied: [], skipped: [] });
  });
});
