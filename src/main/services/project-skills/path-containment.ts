import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, normalize, posix, resolve, sep } from "node:path";
import { isPathInside } from "./import-fs.ts";

/**
 * Reject project-relative paths that could escape via `..`, absolute form,
 * empty/`.` segments, NUL, or control characters (design §6.1).
 */
function assertContainedRelativePath(relativePath: string): string[] {
  if (relativePath.length === 0) {
    throw new Error("project-relative path must not be empty");
  }
  if (relativePath.includes("\0")) {
    throw new Error("project-relative path must not contain NUL");
  }
  for (const ch of relativePath) {
    if (ch.charCodeAt(0) < 0x20) {
      throw new Error(
        "project-relative path must not contain control characters"
      );
    }
  }
  if (isAbsolute(relativePath)) {
    throw new Error(
      `project-relative path must not be absolute: ${relativePath}`
    );
  }

  const posixForm = relativePath.split(sep).join(posix.sep);
  const normalized = normalize(posixForm);
  if (
    normalized === ".." ||
    normalized.startsWith(`..${posix.sep}`) ||
    isAbsolute(normalized)
  ) {
    throw new Error(`project-relative path escapes root: ${relativePath}`);
  }

  const segments = posixForm.split(posix.sep);
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`invalid path segment in ${relativePath}`);
    }
  }
  return segments;
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * True when lstat reports a real directory (not a symlink / reparse-as-link).
 * Non-directory entries and symlink segments are rejected by callers.
 */
function isRealDirectoryStat(info: {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): boolean {
  return info.isDirectory() && !info.isSymbolicLink();
}

/**
 * Walk each existing segment of `relativePath` under `projectRoot` with
 * `lstat`. Reject symlink / non-directory ancestors. Missing segments are OK
 * (walk stops at the first ENOENT).
 */
export async function assertProjectRelativeAncestorsReal(
  projectRoot: string,
  relativePath: string
): Promise<void> {
  const segments = assertContainedRelativePath(relativePath);
  let current = resolve(projectRoot);

  for (const segment of segments) {
    current = join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw new Error(
          `project ancestor must not be a symbolic link: ${current}`
        );
      }
      if (!info.isDirectory()) {
        throw new Error(
          `project ancestor must be a real directory: ${current}`
        );
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }
      throw error;
    }
  }
}

/**
 * Create missing directory segments under `projectRoot` one level at a time
 * (non-recursive `mkdir` per level). Refuses if any existing segment is a
 * symlink or non-directory. After creation, verifies the resolved path stays
 * inside `realpath(projectRoot)`.
 */
export async function ensureProjectRelativeDir(
  projectRoot: string,
  relativeDir: string
): Promise<void> {
  const segments = assertContainedRelativePath(relativeDir);
  const rootResolved = resolve(projectRoot);
  let current = rootResolved;

  for (const segment of segments) {
    current = join(current, segment);
    try {
      const info = await lstat(current);
      if (!isRealDirectoryStat(info)) {
        throw new Error(
          info.isSymbolicLink()
            ? `project directory segment must not be a symbolic link: ${current}`
            : `project directory segment must be a real directory: ${current}`
        );
      }
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      await mkdir(current);
    }
  }

  const rootReal = await realpath(rootResolved);
  const dirReal = await realpath(current);
  if (!isPathInside(rootReal, dirReal)) {
    throw new Error(
      `project directory resolved outside project root: ${dirReal}`
    );
  }
}
