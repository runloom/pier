import { ancestorDirectoryPaths } from "./files-path-query-materialize.ts";
import { revealFilesTreePath } from "./files-tree-registry.ts";
import {
  ensureAncestorDirectoryEntries,
  getFilesTreeSnapshot,
  loadFilesTreeDirectory,
} from "./files-tree-store.ts";
import type { FilesTreeList } from "./files-tree-visibility.ts";

/**
 * Ensure ancestor entries exist, load real directory listings (so expand is not
 * stuck on empty "loaded" stubs), then reveal after the tree can observe the
 * updated snapshot. Calling reveal in the same turn as ensure/load races the
 * React items→model sync.
 */
export function revealFilesTreePathAfterAncestors(target: {
  instanceId?: string | undefined;
  list: FilesTreeList;
  path: string;
  root: string;
}): void {
  revealFilesTreePathAfterAncestorsAsync(target).catch(() => undefined);
}

async function revealFilesTreePathAfterAncestorsAsync(target: {
  instanceId?: string | undefined;
  list: FilesTreeList;
  path: string;
  root: string;
}): Promise<void> {
  if (target.path.length > 0) {
    ensureAncestorDirectoryEntries(target.root, target.path);
  }

  // Same discipline as path-query materialize: stubs alone are not enough —
  // PierFileTree only fetches on unload/error expand, so breadcrumb must load.
  for (const directoryPath of ancestorDirectoryPaths(target.path)) {
    await loadFilesTreeDirectory(target.root, directoryPath, target.list);
  }

  const entry = getFilesTreeSnapshot(target.root).entriesByPath.get(
    target.path
  );
  if (entry?.kind === "directory") {
    await loadFilesTreeDirectory(target.root, target.path, target.list);
  }

  const run = () => {
    revealFilesTreePath(target);
  };
  run();
  queueMicrotask(run);
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
  }
}
