import type { FileWatchEvent } from "@shared/contracts/file-watch.ts";
import {
  getFilesTreeSnapshot,
  removeFilesTreeEntry,
} from "./files-tree-store.ts";
import { parentDirectoryPath } from "./files-tree-store-ops.ts";
import type { FilesTreeList } from "./files-tree-visibility.ts";
import {
  refreshFilesTreeDirectoryAfterPendingLoad,
  refreshFilesTreeRootAfterPendingLoad,
} from "./files-tree-watch-refresh.ts";

function parentPathRefreshable(
  snapshot: ReturnType<typeof getFilesTreeSnapshot>,
  path: string
): boolean {
  const parentPath = parentDirectoryPath(path);
  if (parentPath === null) {
    return (snapshot.rootLoaded || snapshot.rootLoading) && !snapshot.rootError;
  }
  const state = snapshot.directoryStatesByPath.get(parentPath);
  return state === "loaded" || state === "empty" || state === "loading";
}

function addParentRefresh(
  path: string,
  parentsToRefresh: Set<string>
): boolean {
  const parentPath = parentDirectoryPath(path);
  if (parentPath === null) {
    return true;
  }
  parentsToRefresh.add(parentPath);
  return false;
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
  const directoriesToRefresh = new Set<string>();
  const createdKnownDirectories = new Set<string>();

  for (const change of event.changes) {
    if (change.path === ".") {
      needsRootReload = true;
      continue;
    }

    if (change.kind === "deleted") {
      if (snapshot.entriesByPath.has(change.path)) {
        removeFilesTreeEntry(root, change.path);
      }
      // 删除可能发生在父目录加载期间；旧 listing 随后可能把条目加回来。
      if (parentPathRefreshable(snapshot, change.path)) {
        needsRootReload =
          addParentRefresh(change.path, parentsToRefresh) || needsRootReload;
      }
      continue;
    }

    const existing = snapshot.entriesByPath.get(change.path);
    if (existing) {
      // macOS 可能只上报已知目录自身。created 还可能表示类型替换：先重列
      // 父级确认真实类型，再决定是否重列原目录，避免并发请求复活旧子树。
      const directoryState = snapshot.directoryStatesByPath.get(change.path);
      if (
        existing.kind === "directory" &&
        (directoryState === "loaded" ||
          directoryState === "empty" ||
          directoryState === "loading")
      ) {
        if (change.kind === "created") {
          createdKnownDirectories.add(change.path);
        } else {
          directoriesToRefresh.add(change.path);
        }
      }
      if (
        change.kind === "created" &&
        parentPathRefreshable(snapshot, change.path)
      ) {
        needsRootReload =
          addParentRefresh(change.path, parentsToRefresh) || needsRootReload;
      }
      continue;
    }

    // 未知路径只重读已加载的父目录，类型来自真实 listing。
    if (!parentPathRefreshable(snapshot, change.path)) {
      continue;
    }
    needsRootReload =
      addParentRefresh(change.path, parentsToRefresh) || needsRootReload;
  }

  (async () => {
    const parentRefreshes = [...parentsToRefresh].map((parentPath) =>
      refreshFilesTreeDirectoryAfterPendingLoad(root, parentPath, list)
    );
    if (needsRootReload) {
      parentRefreshes.push(
        refreshFilesTreeRootAfterPendingLoad(root, list, fallbackError).then(
          () => ({ ok: true }) as const
        )
      );
    }
    await Promise.all(parentRefreshes);

    for (const path of createdKnownDirectories) {
      if (
        getFilesTreeSnapshot(root).entriesByPath.get(path)?.kind === "directory"
      ) {
        directoriesToRefresh.add(path);
      }
    }
    await Promise.all(
      [...directoriesToRefresh].map((path) =>
        refreshFilesTreeDirectoryAfterPendingLoad(root, path, list)
      )
    );
  })().catch(() => undefined);
}
