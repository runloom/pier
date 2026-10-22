import type { FileWatchEvent } from "@shared/contracts/file/watch.ts";
import { getFilesTreeSnapshot, removeFilesTreeEntry } from "./store.ts";
import { parentDirectoryPath } from "./store-ops.ts";
import type { FilesTreeList } from "./visibility.ts";
import {
  refreshFilesTreeDirectoryAfterPendingLoad,
  refreshFilesTreeRootAfterPendingLoad,
} from "./watch-refresh.ts";

const TRAILING_SLASHES_PATTERN = /\/+$/;

/**
 * `.` 哨兵的根重载最小间隔。
 *
 * 哨兵来自 main 侧的轮询兜底：fs.watch 建不起来时每个轮询周期发一次。它没有
 * 精确路径，只能整树重载 —— 在条目多的根上是每周期一次的 O(全部条目) 同步
 * 工作。main 已经退避到 60s 封顶，这里再兜一层：同一根的哨兵重载不早于该间隔，
 * 期间到达的哨兵合并成下一次重载。
 */
export const FILES_TREE_SENTINEL_RELOAD_MIN_INTERVAL_MS = 15_000;

const lastSentinelReloadAtByRoot = new Map<string, number>();
const pendingSentinelReloadByRoot = new Map<
  string,
  {
    list: FilesTreeList;
    fallbackError: string;
    timer: ReturnType<typeof setTimeout>;
  }
>();

function clearSentinelState(root: string): void {
  lastSentinelReloadAtByRoot.delete(root);
  const pending = pendingSentinelReloadByRoot.get(root);
  if (pending) {
    clearTimeout(pending.timer);
    pendingSentinelReloadByRoot.delete(root);
  }
}

function scheduleSentinelRootReload(
  root: string,
  list: FilesTreeList,
  fallbackError: string
): void {
  const pending = pendingSentinelReloadByRoot.get(root);
  if (pending) {
    return;
  }
  const last = lastSentinelReloadAtByRoot.get(root);
  const elapsed =
    last === undefined ? Number.POSITIVE_INFINITY : Date.now() - last;
  if (elapsed >= FILES_TREE_SENTINEL_RELOAD_MIN_INTERVAL_MS) {
    lastSentinelReloadAtByRoot.set(root, Date.now());
    refreshFilesTreeRootAfterPendingLoad(root, list, fallbackError).catch(
      () => undefined
    );
    return;
  }
  const delay = FILES_TREE_SENTINEL_RELOAD_MIN_INTERVAL_MS - elapsed;
  const timer = setTimeout(() => {
    pendingSentinelReloadByRoot.delete(root);
    lastSentinelReloadAtByRoot.set(root, Date.now());
    refreshFilesTreeRootAfterPendingLoad(root, list, fallbackError).catch(
      () => undefined
    );
  }, delay);
  pendingSentinelReloadByRoot.set(root, { fallbackError, list, timer });
}

/** 树面板关闭 / 根切换时丢弃节流状态，避免把旧根的时间戳带给下一次打开。 */
export function resetFilesTreeSentinelThrottle(root?: string): void {
  if (root === undefined) {
    for (const key of lastSentinelReloadAtByRoot.keys()) {
      clearSentinelState(key);
    }
    return;
  }
  clearSentinelState(root);
}

function normalizeRoot(root: string): string {
  return root.replace(TRAILING_SLASHES_PATTERN, "");
}

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
  if (normalizeRoot(event.root) !== normalizeRoot(root)) {
    return;
  }

  const snapshot = getFilesTreeSnapshot(root);
  let needsRootReload = false;
  let needsSentinelReload = false;
  const parentsToRefresh = new Set<string>();
  const directoriesToRefresh = new Set<string>();
  const createdKnownDirectories = new Set<string>();

  for (const change of event.changes) {
    if (change.path === ".") {
      needsSentinelReload = true;
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
    // 真实路径事件比哨兵精确；同批里已有真实路径时，不再叠加一次整树重载。
    const hasRealPathChange = event.changes.some(
      (change) => change.path !== "."
    );
    if (needsSentinelReload && !hasRealPathChange) {
      scheduleSentinelRootReload(root, list, fallbackError);
    }
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
