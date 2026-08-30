import { realpath as fsRealpath, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LIVE_MODULE_DEFAULT_HOME_DIRECTORY,
  LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES,
  LIVE_MODULES_PROJECT_CONFIG_PATH,
} from "@shared/contracts/live-modules.ts";
import {
  normalizeContentDirectoryList,
  parseLiveModulesProjectConfig,
} from "@shared/live-module-canvas-path.ts";
import { execGit } from "../git/exec.ts";
import { resolveGitWorktreeFamily } from "../git/worktree/main-path.ts";

export interface ResolveCanvasContentDirectoriesDeps {
  isHomeRoot: boolean;
  readConfig?: (configRootPath: string) => Promise<string | null>;
  resolveConfigRoot?: (projectRootPath: string) => Promise<string>;
}

async function defaultResolveConfigRoot(
  projectRootPath: string
): Promise<string> {
  try {
    const family = await resolveGitWorktreeFamily(projectRootPath, {
      execGit: (args, cwd) => execGit(args, { cwd }),
      realpath: fsRealpath,
    });
    if (family) {
      return family.mainPath;
    }
  } catch {
    // Not a git work tree, or git is unavailable.
  }
  return projectRootPath;
}

async function readLiveModulesConfig(
  configRootPath: string,
  readConfig?: (configRootPath: string) => Promise<string | null>
): Promise<string[]> {
  try {
    const raw =
      readConfig === undefined
        ? await readFile(
            join(configRootPath, LIVE_MODULES_PROJECT_CONFIG_PATH),
            "utf8"
          )
        : await readConfig(configRootPath);
    if (raw === null) {
      return [...LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES];
    }
    return parseLiveModulesProjectConfig(raw).contentDirectories;
  } catch {
    return [...LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES];
  }
}

/**
 * Effective canvas preview roots for a project (or Pier home).
 * Linked worktrees read the primary checkout's `.pier/live-modules.json`.
 * Home roots also accept `canvases/`.
 */
export async function resolveCanvasContentDirectories(
  projectRootPath: string,
  deps: ResolveCanvasContentDirectoriesDeps
): Promise<string[]> {
  const configRoot = await (deps.resolveConfigRoot ?? defaultResolveConfigRoot)(
    projectRootPath
  );
  const fromDisk = await readLiveModulesConfig(configRoot, deps.readConfig);
  if (!deps.isHomeRoot) {
    return fromDisk;
  }
  return normalizeContentDirectoryList([
    LIVE_MODULE_DEFAULT_HOME_DIRECTORY,
    ...fromDisk,
  ]);
}
