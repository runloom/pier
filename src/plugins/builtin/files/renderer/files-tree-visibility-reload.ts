import {
  getFilesTreeSnapshot,
  loadFilesTreeDirectory,
  reloadFilesTreeRoot,
} from "./files-tree-store.ts";
import type { FilesTreeList } from "./files-tree-visibility.ts";

interface VisibilityReloadState {
  completedVersion: number;
  fallbackError: string;
  list: FilesTreeList;
  promise: Promise<void>;
  requestedVersion: number;
}

const reloadsByRoot = new Map<string, VisibilityReloadState>();

function loadedDirectoryPaths(root: string): string[] {
  return [...getFilesTreeSnapshot(root).directoryStatesByPath.entries()]
    .filter(([, state]) => state === "loaded" || state === "empty")
    .map(([path]) => path)
    .sort((left, right) => {
      const depthDifference = left.split("/").length - right.split("/").length;
      return depthDifference || left.localeCompare(right);
    });
}

function reloadError(path: string, error: unknown, fallback: string): Error {
  const detail =
    error instanceof Error && error.message.length > 0
      ? error.message
      : fallback;
  return new Error(path.length > 0 ? `${path}: ${detail}` : detail);
}

async function runVisibilityReloadPass(
  root: string,
  list: FilesTreeList,
  fallbackError: string
): Promise<void> {
  const pathsToReload = loadedDirectoryPaths(root);
  const joinedActiveRootLoad = getFilesTreeSnapshot(root).rootLoading;
  await reloadFilesTreeRoot(root, list, fallbackError);
  // force reload 在已有 root load 上只会 join；配置变更必须在旧请求完成后再读一次。
  if (joinedActiveRootLoad) {
    await reloadFilesTreeRoot(root, list, fallbackError);
  }
  const rootError = getFilesTreeSnapshot(root).rootError;
  if (rootError) {
    throw new Error(rootError);
  }
  // 父目录先更新；若过滤策略移除了某个子树，后续子目录会因 entry 已消失而跳过。
  for (const path of pathsToReload) {
    if (!getFilesTreeSnapshot(root).entriesByPath.has(path)) {
      continue;
    }
    const result = await loadFilesTreeDirectory(root, path, list);
    if (!result.ok) {
      throw reloadError(path, result.error, fallbackError);
    }
  }
}

async function runVisibilityReloads(
  root: string,
  state: VisibilityReloadState
): Promise<void> {
  while (state.completedVersion < state.requestedVersion) {
    const version = state.requestedVersion;
    const { fallbackError, list } = state;
    await runVisibilityReloadPass(root, list, fallbackError);
    state.completedVersion = version;
  }
}

export function reloadFilesTreeVisibility(
  root: string,
  list: FilesTreeList,
  fallbackError: string
): Promise<void> {
  const active = reloadsByRoot.get(root);
  if (active) {
    active.fallbackError = fallbackError;
    active.list = list;
    active.requestedVersion += 1;
    return active.promise;
  }
  const state: VisibilityReloadState = {
    completedVersion: 0,
    fallbackError,
    list,
    promise: Promise.resolve(),
    requestedVersion: 1,
  };
  state.promise = runVisibilityReloads(root, state).finally(() => {
    if (reloadsByRoot.get(root) === state) {
      reloadsByRoot.delete(root);
    }
  });
  reloadsByRoot.set(root, state);
  return state.promise;
}
