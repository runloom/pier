import type {
  PierFileTreeApi,
  PierFileTreeRevealOptions,
} from "@pier/ui/file/tree.tsx";

export interface FilesTreeRegistryEntry {
  collapseAll: () => void;
  expandKnownDirectories: () => void;
  getApi: () => PierFileTreeApi | null;
  openSearch: () => void;
  root: string;
  toggleSearch: () => void;
}

export type FilesPendingCreateKind = "file" | "folder";

export interface FilesPendingCreate {
  kind: FilesPendingCreateKind;
  openAfter: boolean;
  placeholderPath: string;
  root: string;
  treeId?: string;
}

const treeRegistry = new Map<string, FilesTreeRegistryEntry>();
const pendingCreates = new Map<string, FilesPendingCreate>();

function pendingCreateKey(root: string, path: string): string {
  return `${root}\u0000${path}`;
}

function findTreeEntry(target: {
  fallbackToRoot?: boolean | undefined;
  instanceId?: string | undefined;
  root?: string | undefined;
}): FilesTreeRegistryEntry | null {
  if (target.instanceId) {
    const byId = treeRegistry.get(target.instanceId);
    if (byId) {
      return byId;
    }
    if (target.fallbackToRoot === false) {
      return null;
    }
    // Fall through to root match when treeId is stale (panel remount / group id
    // drift). Prefer same-root live tree over silent no-op.
  }
  if (target.root) {
    const normalizeRoot = (value: string) =>
      value.length > 1 ? value.replace(/\/+$/, "") : value;
    const want = normalizeRoot(target.root);
    let lastMatch: FilesTreeRegistryEntry | null = null;
    for (const entry of treeRegistry.values()) {
      if (normalizeRoot(entry.root) === want) {
        lastMatch = entry;
      }
    }
    return lastMatch;
  }
  return null;
}

export function registerFilesTreeInstance(
  instanceId: string,
  entry: FilesTreeRegistryEntry
): () => void {
  treeRegistry.set(instanceId, entry);
  return () => {
    const current = treeRegistry.get(instanceId);
    if (current === entry) {
      treeRegistry.delete(instanceId);
    }
  };
}

export function startFilesTreeInlineRename(target: {
  instanceId?: string | undefined;
  path: string;
  removeIfCanceled?: boolean;
  root: string;
}): boolean {
  const entry = findTreeEntry(target);
  return (
    entry
      ?.getApi()
      ?.startRenaming(
        target.path,
        target.removeIfCanceled ? { removeIfCanceled: true } : undefined
      ) ?? false
  );
}

export function openFilesTreeSearch(target: {
  instanceId?: string | undefined;
  root?: string | undefined;
}): boolean {
  const entry = findTreeEntry(target);
  if (!entry) {
    return false;
  }
  entry.openSearch();
  return true;
}

export function toggleFilesTreeSearch(target: {
  instanceId?: string | undefined;
  root?: string | undefined;
}): boolean {
  const entry = findTreeEntry(target);
  if (!entry) {
    return false;
  }
  entry.toggleSearch();
  return true;
}

/** Bumped to cancel in-flight reveal timeout batches. */
let revealRetryGeneration = 0;

/**
 * Single attempt: true only when the tree API is mounted and the path is
 * selectable. Does not schedule retries (callers that poll should use this).
 */
export function tryRevealFilesTreePathOnce(target: {
  fallbackToRoot?: boolean | undefined;
  instanceId?: string | undefined;
  options?: PierFileTreeRevealOptions | undefined;
  path: string;
  root: string;
}): boolean {
  const entry = findTreeEntry(target);
  const api = entry?.getApi();
  if (!api) {
    return false;
  }
  return api.revealPath(target.path, target.options) === true;
}

export function revealFilesTreePath(target: {
  fallbackToRoot?: boolean | undefined;
  instanceId?: string | undefined;
  options?: PierFileTreeRevealOptions | undefined;
  path: string;
  root: string;
}): boolean {
  if (tryRevealFilesTreePathOnce(target)) {
    return true;
  }
  // Tree may still be mounting after sidebar expand / items→model sync.
  // Cancel prior batches so slow after-ancestors loops do not stack timers.
  revealRetryGeneration += 1;
  const generation = revealRetryGeneration;
  for (const delayMs of [32, 80, 160, 320, 640]) {
    window.setTimeout(() => {
      if (generation !== revealRetryGeneration) {
        return;
      }
      if (tryRevealFilesTreePathOnce(target)) {
        revealRetryGeneration += 1;
      }
    }, delayMs);
  }
  return false;
}

function runTreeFolderAction(
  target: {
    instanceId?: string | undefined;
    /** Directory path when action was invoked from a folder row; omit for whole tree. */
    path?: string | undefined;
    root?: string | undefined;
  },
  action: "collapseAll" | "expandAll"
): boolean {
  const rootPath =
    target.path && target.path.length > 0 ? target.path : undefined;
  const invoke = (): boolean => {
    const entry = findTreeEntry(target);
    if (!entry) {
      return false;
    }
    const api = entry.getApi();
    // Never fall back to whole-tree entry helpers when scoped — that would
    // expand/collapse siblings if the API is briefly null after mount.
    if (!api) {
      return false;
    }
    if (action === "collapseAll") {
      api.collapseAll(rootPath ? { rootPath } : undefined);
    } else {
      api.expandAll(rootPath ? { rootPath } : undefined);
    }
    return true;
  };
  if (invoke()) {
    return true;
  }
  // Tree API may not be attached for a frame after mount / menu focus.
  for (const delayMs of [0, 32, 80, 160]) {
    window.setTimeout(() => {
      invoke();
    }, delayMs);
  }
  return false;
}

export function collapseFilesTreeFolders(target: {
  instanceId?: string | undefined;
  path?: string | undefined;
  root?: string | undefined;
}): boolean {
  return runTreeFolderAction(target, "collapseAll");
}

export function expandFilesTreeKnownFolders(target: {
  instanceId?: string | undefined;
  path?: string | undefined;
  root?: string | undefined;
}): boolean {
  return runTreeFolderAction(target, "expandAll");
}

export function findFilesTreeInstanceId(root: string): string | null {
  let lastId: string | null = null;
  for (const [instanceId, entry] of treeRegistry) {
    if (entry.root === root) {
      lastId = instanceId;
    }
  }
  return lastId;
}

export function registerPendingCreate(pending: FilesPendingCreate): void {
  pendingCreates.set(
    pendingCreateKey(pending.root, pending.placeholderPath),
    pending
  );
}

export function peekPendingCreate(
  root: string,
  path: string
): FilesPendingCreate | null {
  return pendingCreates.get(pendingCreateKey(root, path)) ?? null;
}

/** 目录 merge/watch 时保留尚未落盘的占位路径。 */
export function listPendingCreatePaths(root: string): readonly string[] {
  const paths: string[] = [];
  const prefix = `${root}\u0000`;
  for (const [key, pending] of pendingCreates) {
    if (key.startsWith(prefix) && pending.root === root) {
      paths.push(pending.placeholderPath);
    }
  }
  return paths;
}

export function hasPendingCreatePath(root: string, path: string): boolean {
  return pendingCreates.has(pendingCreateKey(root, path));
}

export function takePendingCreate(
  root: string,
  path: string
): FilesPendingCreate | null {
  const key = pendingCreateKey(root, path);
  const pending = pendingCreates.get(key) ?? null;
  if (pending) {
    pendingCreates.delete(key);
  }
  return pending;
}

export function clearPendingCreate(root: string, path: string): void {
  pendingCreates.delete(pendingCreateKey(root, path));
}

export function removeFilesTreeModelPaths(target: {
  instanceId?: string | undefined;
  paths: readonly string[];
  root: string;
}): void {
  const entry = findTreeEntry(target);
  entry?.getApi()?.removePaths(target.paths);
}

/**
 * 回滚库已先行应用的 rename/drag（磁盘移动失败时）：移除幽灵路径、恢复原路径。
 * 树未挂载（面板折叠）时模型不渲染，跳过即可——重挂载时从 store 重建。
 */
export function rollbackFilesTreeModelMove(target: {
  instanceId?: string | undefined;
  removedPaths: readonly string[];
  restoredPaths: readonly string[];
  root: string;
}): void {
  const entry = findTreeEntry(target);
  entry?.getApi()?.applyPathRollback(target.removedPaths, target.restoredPaths);
}

export function clearFileTreeSidebarCache(): void {
  treeRegistry.clear();
  pendingCreates.clear();
}
