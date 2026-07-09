import type { PierFileTreeApi } from "@pier/ui/file-tree.tsx";

export interface FilesTreeRegistryEntry {
  getApi: () => PierFileTreeApi | null;
  openSearch: () => void;
  root: string;
}

const treeRegistry = new Map<string, FilesTreeRegistryEntry>();

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
  root: string;
}): boolean {
  const entry = findTreeEntry(target);
  return entry?.getApi()?.startRenaming(target.path) ?? false;
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

export function clearFileTreeSidebarCache(): void {
  treeRegistry.clear();
}
