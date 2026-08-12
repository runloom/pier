/**
 * worktree 路径工具（从 service 抽出以控制文件行数）。
 */
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

export function samePath(a: string, b: string): boolean {
  return resolve(a) === resolve(b);
}

export function isInsideDirectory(child: string, parent: string): boolean {
  const childPath = resolve(child);
  const parentPath = resolve(parent);
  const relativePath = relative(parentPath, childPath);
  return (
    relativePath.length > 0 &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
}

export function defaultWorktreeRoot(mainPath: string): string {
  return join(dirname(mainPath), `${basename(mainPath)}.worktree`);
}

export function resolveWorktreeRootPath(
  mainPath: string,
  configuredRootPath: string
): string {
  const rootPath = configuredRootPath.trim();
  if (rootPath.length === 0) {
    return defaultWorktreeRoot(mainPath);
  }
  return isAbsolute(rootPath)
    ? resolve(rootPath)
    : resolve(dirname(mainPath), rootPath);
}

export function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => resolve(path)))];
}

export async function safeRealpath(
  path: string,
  realpath: (path: string) => Promise<string>
): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}
