/**
 * BFS filesystem walk for the Files path query.
 *
 * Yields **relative posix file paths only** (directories are traversed but
 * never emitted). Cooperative cancel via `AbortSignal`; hard cap on scanned
 * entries. Symlinks: skipped when the real target escapes the root, and each
 * real target is visited at most once. Excludes use `minimatch` with the same
 * ancestor-matching semantics as `isExcludedFileTreePath`.
 *
 * Design: docs/superpowers/specs/2026-07-17-files-path-query-and-quick-open-design.md §4.2
 */

import type { Dirent } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { sep as pathSep } from "node:path";
import { Minimatch } from "minimatch";

/** Absolute upper bound so a runaway walk cannot pin the main process. */
export const FILE_WALK_MAX_SCANNED = 50_000;

export interface WalkOptions {
  /** Multiline glob source (see `parseExcludePatternSource`). */
  readonly excludePatternSource: string;
  /** Extra ignore set: exact relative-posix paths OR `dir/` prefixes. */
  readonly ignoredPaths?: ReadonlySet<string> | undefined;
  /** Hard cap; defaults to `FILE_WALK_MAX_SCANNED`. */
  readonly maxScanned?: number | undefined;
  /** Absolute project root (canonical, no trailing slash needed). */
  readonly root: string;
  /** Cooperative cancel. */
  readonly signal?: AbortSignal | undefined;
}

export interface WalkResult {
  /** Root-relative posix file paths (basenames only for root files). */
  readonly paths: string[];
  /** Directories + files inspected (approximate — for observability). */
  readonly scanned: number;
  /** Whether the walk stopped at `maxScanned` before draining the queue. */
  readonly truncated: boolean;
}

/** Public sentinel so callers can distinguish cooperative cancel from I/O errors. */
export class AbortedWalkError extends Error {
  constructor() {
    super("file walk aborted");
    this.name = "AbortedWalkError";
  }
}

/** Compile a multiline glob source once; reused by the walk on every entry. */
export function parseExcludePatternSource(source: string): Minimatch[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map(
      (pattern) =>
        new Minimatch(pattern, {
          dot: true,
          nonegate: true,
        })
    );
}

function isExcluded(
  relativePosix: string,
  matchers: readonly Minimatch[]
): boolean {
  if (matchers.length === 0) return false;
  let candidate = relativePosix;
  while (candidate.length > 0) {
    for (const matcher of matchers) {
      if (matcher.match(candidate)) return true;
    }
    const slash = candidate.lastIndexOf("/");
    if (slash < 0) return false;
    candidate = candidate.slice(0, slash);
  }
  return false;
}

function isGitIgnored(
  relativePosix: string,
  ignored: ReadonlySet<string>
): boolean {
  if (ignored.size === 0) return false;
  if (ignored.has(relativePosix)) return true;
  // `git ls-files --directory` yields `dir/` for folded directories.
  let candidate = relativePosix;
  while (candidate.length > 0) {
    if (ignored.has(`${candidate}/`)) return true;
    const slash = candidate.lastIndexOf("/");
    if (slash < 0) return false;
    candidate = candidate.slice(0, slash);
  }
  return false;
}

/**
 * BFS walk. Resolves with the collected paths (unsorted) and metrics. Throws
 * `AbortedWalkError` when the signal aborts; other errors propagate.
 */
export async function walkFiles(options: WalkOptions): Promise<WalkResult> {
  const { root, excludePatternSource, ignoredPaths, signal } = options;
  const maxScanned = options.maxScanned ?? FILE_WALK_MAX_SCANNED;
  const matchers = parseExcludePatternSource(excludePatternSource);
  const ignored = ignoredPaths ?? new Set<string>();

  let rootReal: string;
  try {
    rootReal = await realpath(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`file walk root inaccessible: ${root}: ${message}`);
  }
  const visitedReal = new Set<string>([rootReal]);
  const queue: Array<{ absolute: string; relative: string }> = [
    { absolute: root, relative: "" },
  ];
  const paths: string[] = [];
  let scanned = 0;
  let truncated = false;

  while (queue.length > 0) {
    if (signal?.aborted) throw new AbortedWalkError();
    const dir = queue.shift();
    if (!dir) break;
    let entries: Dirent[] | undefined;
    try {
      entries = await readdir(dir.absolute, { withFileTypes: true });
    } catch (error) {
      // Root access failure is fatal; nested dirs may vanish mid-walk.
      if (dir.relative === "") {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`file walk root inaccessible: ${root}: ${message}`);
      }
      continue;
    }
    for (const entry of entries) {
      if (signal?.aborted) throw new AbortedWalkError();
      if (scanned >= maxScanned) {
        truncated = true;
        return { paths, truncated, scanned };
      }
      scanned += 1;
      const name = entry.name;
      const relativePosix =
        dir.relative.length === 0 ? name : `${dir.relative}/${name}`;
      if (isExcluded(relativePosix, matchers)) continue;
      if (isGitIgnored(relativePosix, ignored)) continue;

      const absolute = `${dir.absolute}${pathSep}${name}`;

      if (entry.isSymbolicLink()) {
        let real: string;
        try {
          real = await realpath(absolute);
        } catch {
          continue;
        }
        if (real !== rootReal && !real.startsWith(`${rootReal}${pathSep}`)) {
          continue;
        }
        if (visitedReal.has(real)) continue;
        visitedReal.add(real);
        // Try to read as directory; if that fails, treat as file.
        try {
          await readdir(real);
          queue.push({ absolute: real, relative: relativePosix });
        } catch {
          paths.push(relativePosix);
        }
        continue;
      }
      if (entry.isDirectory()) {
        queue.push({ absolute, relative: relativePosix });
        continue;
      }
      if (entry.isFile()) {
        paths.push(relativePosix);
      }
    }
  }

  return { paths, truncated, scanned };
}
