import type { FileEntry } from "@shared/contracts/file.ts";
import {
  getFilesTreeSnapshot,
  loadFilesTreeDirectoryWithDiscovery,
  loadFilesTreeRoot,
} from "./files-tree-store.ts";
import type { FilesTreeList } from "./files-tree-visibility.ts";

const SEARCH_DIRECTORY_LOAD_CONCURRENCY = 8;

export interface FilesTreeSearchLoadFailure {
  error: unknown;
  path: string;
}

export interface FilesTreeSearchLoadResult {
  failures: readonly FilesTreeSearchLoadFailure[];
}

const activeLoadsByRoot = new Map<string, Promise<FilesTreeSearchLoadResult>>();

function initialDirectoryPaths(root: string): string[] {
  const snapshot = getFilesTreeSnapshot(root);
  return [...snapshot.entriesByPath.values()]
    .filter(
      (entry): entry is FileEntry & { kind: "directory" } =>
        entry.kind === "directory"
    )
    .map((entry) => entry.path)
    .filter((path) => {
      const state = snapshot.directoryStatesByPath.get(path);
      return state !== "loaded" && state !== "empty";
    })
    .sort((left, right) => left.localeCompare(right));
}

async function runSearchLoad(
  root: string,
  list: FilesTreeList,
  fallbackError: string
): Promise<FilesTreeSearchLoadResult> {
  await loadFilesTreeRoot(root, list, fallbackError);
  const queuedPaths = new Set<string>();
  const queue: string[] = [];
  const failures: FilesTreeSearchLoadFailure[] = [];
  let cursor = 0;

  const enqueue = (paths: readonly string[]) => {
    const snapshot = getFilesTreeSnapshot(root);
    for (const path of paths) {
      const state = snapshot.directoryStatesByPath.get(path);
      if (queuedPaths.has(path) || state === "loaded" || state === "empty") {
        continue;
      }
      queuedPaths.add(path);
      queue.push(path);
    }
  };
  enqueue(initialDirectoryPaths(root));

  while (cursor < queue.length) {
    const batch = queue.slice(
      cursor,
      cursor + SEARCH_DIRECTORY_LOAD_CONCURRENCY
    );
    cursor += batch.length;
    const results = await Promise.all(
      batch.map(async (path) => ({
        path,
        details: await loadFilesTreeDirectoryWithDiscovery(root, path, list),
      }))
    );
    for (const { details, path } of results) {
      enqueue(details.discoveredDirectoryPaths);
      const { result } = details;
      if (!result.ok) {
        failures.push({ error: result.error, path });
      }
    }
  }
  return { failures };
}

/**
 * 搜索首次运行时补齐当前可见性策略允许的全部目录。按 root 共享进行中的
 * 遍历，避免每次键入或同项目分屏重复发起整树读取。
 */
export function loadFilesTreeForSearch(
  root: string,
  list: FilesTreeList,
  fallbackError: string
): Promise<FilesTreeSearchLoadResult> {
  const activeLoad = activeLoadsByRoot.get(root);
  if (activeLoad) {
    return activeLoad;
  }

  const load = runSearchLoad(root, list, fallbackError).finally(() => {
    if (activeLoadsByRoot.get(root) === load) {
      activeLoadsByRoot.delete(root);
    }
  });
  activeLoadsByRoot.set(root, load);
  return load;
}
