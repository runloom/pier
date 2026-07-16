import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { realpath as fsRealpath, stat as fsStat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { FileSaveTarget } from "@shared/contracts/file-save-target.ts";
import type {
  PanelContext,
  PanelContextSource,
} from "@shared/contracts/panel.ts";
import { execGit } from "./git-exec.ts";
import type { GitExecExecutionBudget } from "./git-exec-raw-contract.ts";
import { parseGitSinglePathOutput } from "./git-path-output.ts";

export interface PanelContextResolutionControl {
  budget?: GitExecExecutionBudget;
  signal?: AbortSignal;
}

export interface ResolvePanelContextOptions {
  execGit?: (
    args: readonly string[],
    cwd: string,
    control?: PanelContextResolutionControl
  ) => Promise<string | { stdout: string }>;
  now?: () => number;
  pathKind?: "auto" | "file";
  realpath?: (path: string) => Promise<string>;
  source?: PanelContextSource;
  stat?: (path: string) => Promise<Stats>;
}

function defaultExecGit(
  args: readonly string[],
  cwd: string,
  control: PanelContextResolutionControl = {}
): Promise<string> {
  return execGit(args, { cwd, ...control });
}

function outputText(output: string | { stdout: string }): string {
  return typeof output === "string" ? output : output.stdout;
}

function cleanScalarOutput(
  output: string | { stdout: string } | undefined
): string {
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

async function safeGitScalar(
  args: readonly string[],
  cwd: string,
  execGit: NonNullable<ResolvePanelContextOptions["execGit"]>,
  control: PanelContextResolutionControl
): Promise<string | undefined> {
  try {
    const output = cleanScalarOutput(await execGit(args, cwd, control));
    return output.length > 0 ? output : undefined;
  } catch {
    return;
  }
}

async function safeGitPath(
  args: readonly string[],
  cwd: string,
  execGit: NonNullable<ResolvePanelContextOptions["execGit"]>,
  control: PanelContextResolutionControl
): Promise<string | undefined> {
  try {
    return (
      parseGitSinglePathOutput(outputText(await execGit(args, cwd, control))) ??
      undefined
    );
  } catch {
    return;
  }
}

async function supportsGitWorktree(
  cwd: string,
  execGit: NonNullable<ResolvePanelContextOptions["execGit"]>,
  control: PanelContextResolutionControl
): Promise<boolean> {
  try {
    await execGit(["worktree", "list", "--porcelain", "-z"], cwd, control);
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
    pathKind = "auto",
    realpath = fsRealpath,
    source = "command",
    stat = fsStat,
  }: ResolvePanelContextOptions = {},
  control: PanelContextResolutionControl = {}
): Promise<PanelContext> {
  const openedPath = await safeRealpath(inputPath, realpath);
  const pathStats = await safeStat(openedPath, stat);
  const cwd =
    pathKind === "file" || pathStats?.isFile()
      ? dirname(openedPath)
      : openedPath;

  const gitRoot = await realGitPath(
    await safeGitPath(["rev-parse", "--show-toplevel"], cwd, execGit, control),
    realpath
  );
  const gitCommonDir = await realGitPath(
    await safeGitPath(
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      cwd,
      execGit,
      control
    ),
    realpath
  );
  const branch = await safeGitScalar(
    ["branch", "--show-current"],
    cwd,
    execGit,
    control
  );
  const head = await safeGitScalar(
    ["rev-parse", "--verify", "HEAD"],
    cwd,
    execGit,
    control
  );
  const projectRoot = gitRoot ?? cwd;
  const worktreeRoot = gitRoot;
  const worktreeKey = worktreeRoot ?? projectRoot;
  const worktreeSupported = gitRoot
    ? await supportsGitWorktree(cwd, execGit, control)
    : undefined;
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
    projectRootPath: projectRoot,
    ...(worktreeRoot ? { worktreeRoot } : {}),
    ...(worktreeSupported == null ? {} : { worktreeSupported }),
  };
}

function relativePathWithinRoot(root: string, target: string): string | null {
  const pathFromRoot = relative(root, target);
  if (
    pathFromRoot.length === 0 ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    return null;
  }
  return pathFromRoot;
}

/**
 * 把原生保存对话框返回的绝对路径转换为文件服务可持久恢复的路径锚点。
 * 当前项目内沿用调用方的工作区上下文；项目外以目标文件父目录或 Git 根建立新上下文。
 */
export async function resolveFileSaveTargetForPath(
  selectedPath: string,
  currentContext: PanelContext,
  options: Omit<ResolvePanelContextOptions, "pathKind" | "source"> = {}
): Promise<FileSaveTarget> {
  if (!isAbsolute(selectedPath)) {
    throw new Error("save target must be an absolute path");
  }

  const absoluteTarget = resolve(selectedPath);
  const currentRoot = resolve(currentContext.projectRootPath);
  const currentRelativePath = relativePathWithinRoot(
    currentRoot,
    absoluteTarget
  );
  if (currentRelativePath) {
    return {
      context: currentContext,
      path: currentRelativePath,
      root: currentContext.projectRootPath,
    };
  }

  const context = await resolvePanelContextForPath(absoluteTarget, {
    ...options,
    pathKind: "file",
    source: "panel",
  });
  const target = context.openedPath ?? absoluteTarget;
  const root = context.projectRootPath;
  const path = relativePathWithinRoot(root, target);
  if (!path) {
    throw new Error("save target could not be anchored to its panel context");
  }
  return { context, path, root };
}
