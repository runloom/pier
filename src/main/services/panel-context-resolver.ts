import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { realpath as fsRealpath, stat as fsStat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  PanelContext,
  PanelContextSource,
} from "@shared/contracts/panel.ts";
import { upsertProjectFromPath } from "../state/project-store.ts";
import { execGit } from "./git-exec.ts";

let upsertWarned = false;

export interface ResolvePanelContextOptions {
  execGit?: (
    args: readonly string[],
    cwd: string
  ) => Promise<string | { stdout: string }>;
  now?: () => number;
  realpath?: (path: string) => Promise<string>;
  source?: PanelContextSource;
  stat?: (path: string) => Promise<Stats>;
}

function defaultExecGit(args: readonly string[], cwd: string): Promise<string> {
  return execGit(args, { cwd });
}

function outputText(output: string | { stdout: string }): string {
  return typeof output === "string" ? output : output.stdout;
}

function cleanOutput(output: string | { stdout: string } | undefined): string {
  return outputText(output ?? "").trim();
}

async function safeRealpath(
  path: string,
  realpath: (path: string) => Promise<string>
): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function safeStat(
  path: string,
  stat: (path: string) => Promise<Stats>
): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

async function safeGit(
  args: readonly string[],
  cwd: string,
  execGit: NonNullable<ResolvePanelContextOptions["execGit"]>
): Promise<string | undefined> {
  try {
    const output = cleanOutput(await execGit(args, cwd));
    return output.length > 0 ? output : undefined;
  } catch {
    return;
  }
}

async function supportsGitWorktree(
  cwd: string,
  execGit: NonNullable<ResolvePanelContextOptions["execGit"]>
): Promise<boolean> {
  try {
    await execGit(["worktree", "list", "--porcelain", "-z"], cwd);
    return true;
  } catch {
    return false;
  }
}

async function realGitPath(
  path: string | undefined,
  realpath: (path: string) => Promise<string>
): Promise<string | undefined> {
  if (!path) {
    return;
  }
  return await safeRealpath(path, realpath);
}

function contextIdFor(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return `ctx:${hash}`;
}

export async function resolvePanelContextForPath(
  inputPath: string,
  {
    execGit = defaultExecGit,
    now = Date.now,
    realpath = fsRealpath,
    source = "command",
    stat = fsStat,
  }: ResolvePanelContextOptions = {}
): Promise<PanelContext> {
  const openedPath = await safeRealpath(inputPath, realpath);
  const pathStats = await safeStat(openedPath, stat);
  const cwd = pathStats?.isFile() ? dirname(openedPath) : openedPath;

  const gitRoot = await realGitPath(
    await safeGit(["rev-parse", "--show-toplevel"], cwd, execGit),
    realpath
  );
  const gitCommonDir = await realGitPath(
    await safeGit(
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      cwd,
      execGit
    ),
    realpath
  );
  const branch = await safeGit(["branch", "--show-current"], cwd, execGit);
  const head = await safeGit(["rev-parse", "--verify", "HEAD"], cwd, execGit);
  const projectRoot = gitRoot ?? cwd;
  const worktreeRoot = gitRoot;
  const worktreeKey = worktreeRoot ?? projectRoot;
  const worktreeSupported = gitRoot
    ? await supportsGitWorktree(cwd, execGit)
    : undefined;
  const project = await upsertProjectFromPath(projectRoot, now).catch(
    (err: unknown) => {
      if (!upsertWarned) {
        upsertWarned = true;
        console.warn(
          "[panel-context] upsertProjectFromPath failed:",
          err instanceof Error ? err.message : String(err)
        );
      }
      return null;
    }
  );

  return {
    contextId: contextIdFor(worktreeKey),
    cwd,
    openedPath,
    source,
    updatedAt: now(),
    worktreeKey,
    ...(branch ? { branch } : {}),
    ...(gitCommonDir ? { gitCommonDir } : {}),
    ...(gitRoot ? { gitRoot } : {}),
    ...(head ? { head } : {}),
    ...(project
      ? { projectId: project.id, projectRootPath: project.rootPath }
      : { projectRootPath: projectRoot }),
    ...(worktreeRoot ? { worktreeRoot } : {}),
    ...(worktreeSupported == null ? {} : { worktreeSupported }),
  };
}
