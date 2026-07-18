/**
 * Materialize path-query hits into the files tree store so PierFileTree
 * setSearch / hide-non-matches can show them without a whole-tree BFS list.
 *
 * Design: docs/superpowers/specs/2026-07-18-files-tree-search-path-query-keep-tree-ui-design.md
 */
import {
  addFilesTreeEntry,
  ensureAncestorDirectoryEntries,
  getFilesTreeSnapshot,
  loadFilesTreeDirectory,
} from "./files-tree-store.ts";
import type { FilesTreeList } from "./files-tree-visibility.ts";

const DIRECTORY_LOAD_CONCURRENCY = 8;

export function ancestorDirectoryPaths(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return [];
  }
  const ancestors: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    ancestors.push(segments.slice(0, index).join("/"));
  }
  return ancestors;
}

function collectAncestorDirectories(paths: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const path of paths) {
    for (const ancestor of ancestorDirectoryPaths(path)) {
      dirs.add(ancestor);
    }
  }
  return [...dirs].sort((left, right) => {
    const depthDelta =
      left.split("/").filter(Boolean).length -
      right.split("/").filter(Boolean).length;
    if (depthDelta !== 0) {
      return depthDelta;
    }
    return left.localeCompare(right);
  });
}

async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  let nextIndex = 0;
  const run = async (): Promise<void> => {
    while (nextIndex < items.length) {
      if (signal?.aborted) {
        return;
      }
      const current = nextIndex;
      nextIndex += 1;
      const item = items[current];
      if (item === undefined) {
        return;
      }
      await worker(item);
    }
  };
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => run()
  );
  await Promise.all(workers);
}

/**
 * Ensure hit paths exist in the tree store via ancestor directory loads only.
 * Does not BFS the whole repository.
 */
export async function materializePathQueryHits(input: {
  list: FilesTreeList;
  paths: readonly string[];
  root: string;
  signal?: AbortSignal;
}): Promise<void> {
  const { list, paths, root, signal } = input;
  if (paths.length === 0 || signal?.aborted) {
    return;
  }

  for (const path of paths) {
    if (signal?.aborted) {
      return;
    }
    ensureAncestorDirectoryEntries(root, path);
  }

  const ancestors = collectAncestorDirectories(paths);
  await mapPool(
    ancestors,
    DIRECTORY_LOAD_CONCURRENCY,
    async (directoryPath) => {
      if (signal?.aborted) {
        return;
      }
      await loadFilesTreeDirectory(root, directoryPath, list);
    },
    signal
  );

  if (signal?.aborted) {
    return;
  }

  // Parent list should have added file entries; inject any still-missing hits.
  const snapshot = getFilesTreeSnapshot(root);
  for (const path of paths) {
    if (signal?.aborted) {
      return;
    }
    if (snapshot.entriesByPath.has(path)) {
      continue;
    }
    addFilesTreeEntry(root, {
      kind: "file",
      path,
      root,
    });
  }
}
