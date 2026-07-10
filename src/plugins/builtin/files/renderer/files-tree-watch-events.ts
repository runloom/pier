import type { FileWatchEvent } from "@shared/contracts/file-watch.ts";
import {
  getFilesTreeSnapshot,
  loadFilesTreeDirectory,
  reloadFilesTreeRoot,
  removeFilesTreeEntry,
} from "./files-tree-store.ts";
import { parentDirectoryPath } from "./files-tree-store-ops.ts";
import type { FilesTreeList } from "./files-tree-visibility.ts";

function parentPathLoaded(
  snapshot: ReturnType<typeof getFilesTreeSnapshot>,
  path: string
): boolean {
  const parentPath = parentDirectoryPath(path);
  if (parentPath === null) {
    return snapshot.rootLoaded && !snapshot.rootError;
  }
  const state = snapshot.directoryStatesByPath.get(parentPath);
  return state === "loaded" || state === "empty";
}

export function applyFilesTreeWatchEvent(
  root: string,
  event: FileWatchEvent,
  list: FilesTreeList,
  fallbackError: string
): void {
  if (event.root !== root) {
    return;
  }

  const snapshot = getFilesTreeSnapshot(root);
  let needsRootReload = false;
  const parentsToRefresh = new Set<string>();

  for (const change of event.changes) {
    if (change.path === ".") {
      needsRootReload = true;
      continue;
    }

    if (change.kind === "deleted") {
      if (
        snapshot.entriesByPath.has(change.path) ||
        parentPathLoaded(snapshot, change.path)
      ) {
        removeFilesTreeEntry(root, change.path);
      }
      continue;
    }

    // 已知 entry 不猜 kind；未知路径只重读已加载的父目录，类型来自真实 listing。
    if (
      snapshot.entriesByPath.has(change.path) ||
      !parentPathLoaded(snapshot, change.path)
    ) {
      continue;
    }
    const parentPath = parentDirectoryPath(change.path);
    if (parentPath === null) {
      needsRootReload = true;
    } else {
      parentsToRefresh.add(parentPath);
    }
  }

  for (const parentPath of parentsToRefresh) {
    loadFilesTreeDirectory(root, parentPath, list).catch(() => undefined);
  }
  if (needsRootReload) {
    reloadFilesTreeRoot(root, list, fallbackError).catch(() => undefined);
  }
}
