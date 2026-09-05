import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "@main/services/git/exec.ts";
import { afterEach } from "vitest";

const roots: string[] = [];

export async function makeBaselineRepo(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pier-baseline-")));
  roots.push(root);
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.email", "test@pier.local");
  await git(root, "config", "user.name", "Pier Test");
  await git(root, "config", "commit.gpgsign", "false");
  await git(root, "config", "core.autocrlf", "false");
  await git(root, "config", "core.hooksPath", join(root, ".no-hooks"));
  return root;
}

export function git(root: string, ...args: string[]): Promise<string> {
  return execGit(args, { cwd: root });
}

export async function commitFile(
  root: string,
  path = "file.txt",
  contents: string | Buffer = "at HEAD\n"
): Promise<string> {
  await writeFile(join(root, path), contents);
  await git(root, "add", "--", path);
  await git(root, "commit", "-m", "baseline fixture");
  return (await git(root, "rev-parse", "HEAD")).trim();
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
