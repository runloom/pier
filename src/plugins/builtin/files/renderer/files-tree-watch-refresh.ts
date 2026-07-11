import {
  type FilesTreeDirectoryLoadResult,
  getFilesTreeSnapshot,
  getPendingFilesTreeDirectoryLoad,
  getPendingFilesTreeRootLoad,
  loadFilesTreeDirectory,
  reloadFilesTreeRoot,
} from "./files-tree-store.ts";
import type { FilesTreeList } from "./files-tree-visibility.ts";

export async function refreshFilesTreeRootAfterPendingLoad(
  root: string,
  list: FilesTreeList,
  fallbackError: string
): Promise<void> {
  const activeLoad = getPendingFilesTreeRootLoad(root);
  if (activeLoad) {
    await activeLoad;
  }
  await reloadFilesTreeRoot(root, list, fallbackError);
}

export async function refreshFilesTreeDirectoryAfterPendingLoad(
  root: string,
  path: string,
  list: FilesTreeList
): Promise<FilesTreeDirectoryLoadResult> {
  const activeLoad = getPendingFilesTreeDirectoryLoad(root, path);
  if (activeLoad) {
    await activeLoad.catch(() => undefined);
  }
  if (
    getFilesTreeSnapshot(root).entriesByPath.get(path)?.kind !== "directory"
  ) {
    return { ok: true };
  }
  return await loadFilesTreeDirectory(root, path, list);
}
