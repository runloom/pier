import type { PierFileTreeApi } from "@pier/ui/file-tree.tsx";

export interface FilesTreeRegistryEntry {
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
  instanceId?: string | undefined;
  root?: string | undefined;
}): FilesTreeRegistryEntry | null {
  if (target.instanceId) {
    return treeRegistry.get(target.instanceId) ?? null;
  }
  if (target.root) {
    let lastMatch: FilesTreeRegistryEntry | null = null;
    for (const entry of treeRegistry.values()) {
      if (entry.root === target.root) {
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

export function revealFilesTreePath(target: {
  instanceId?: string | undefined;
  path: string;
  root: string;
}): boolean {
  const entry = findTreeEntry(target);
  const api = entry?.getApi();
  if (!api) {
    return false;
  }
  api.revealPath(target.path);
  return true;
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

export function clearFileTreeSidebarCache(): void {
  treeRegistry.clear();
  pendingCreates.clear();
}
