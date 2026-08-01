import type { PierFileTreeRevealOptions } from "@pier/ui/file/tree.tsx";
import { ancestorDirectoryPaths } from "../search/path-query-materialize.ts";
import { revealFilesTreePath, tryRevealFilesTreePathOnce } from "./registry.ts";
import {
  ensureAncestorDirectoryEntries,
  getFilesTreeSnapshot,
  loadFilesTreeDirectory,
} from "./store.ts";
import type { FilesTreeList } from "./visibility.ts";

const REVEAL_READY_MAX_ATTEMPTS = 24;
const REVEAL_READY_BASE_DELAY_MS = 16;

/**
 * Ensure ancestor entries exist and load real directory listings (so expand is
 * not stuck on empty "loaded" stubs). Does not reveal — use after materialize
 * when the tree's revealPath prop or an explicit reveal should own selection.
 */
export async function ensureFilesTreeAncestorsLoaded(target: {
  list: FilesTreeList;
  path: string;
  root: string;
}): Promise<void> {
  if (target.path.length > 0) {
    ensureAncestorDirectoryEntries(target.root, target.path);
  }

  for (const directoryPath of ancestorDirectoryPaths(target.path)) {
    await loadFilesTreeDirectory(target.root, directoryPath, target.list);
  }

  const entry = getFilesTreeSnapshot(target.root).entriesByPath.get(
    target.path
  );
  if (entry?.kind === "directory") {
    await loadFilesTreeDirectory(target.root, target.path, target.list);
  }
}

/**
 * Ensure ancestor entries exist, load real directory listings, then reveal
 * after the tree can observe the updated snapshot. Calling reveal in the same
 * turn as ensure/load races the React items→model sync.
 */
export function revealFilesTreePathAfterAncestors(target: {
  instanceId?: string | undefined;
  list: FilesTreeList;
  options?: PierFileTreeRevealOptions | undefined;
  path: string;
  root: string;
}): void {
  revealFilesTreePathAfterAncestorsAsync(target).catch(() => undefined);
}

async function revealFilesTreePathAfterAncestorsAsync(target: {
  instanceId?: string | undefined;
  list: FilesTreeList;
  options?: PierFileTreeRevealOptions | undefined;
  path: string;
  root: string;
}): Promise<void> {
  await ensureFilesTreeAncestorsLoaded(target);
  await waitUntilRevealReady(target);
}

async function waitUntilRevealReady(target: {
  instanceId?: string | undefined;
  options?: PierFileTreeRevealOptions | undefined;
  path: string;
  root: string;
}): Promise<void> {
  for (let attempt = 0; attempt < REVEAL_READY_MAX_ATTEMPTS; attempt += 1) {
    // Poll with a single attempt — never schedule registry timeout storms.
    if (tryRevealFilesTreePathOnce(target)) {
      // One paint still races row DOM focus/selection.
      queueMicrotask(() => {
        tryRevealFilesTreePathOnce(target);
      });
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          tryRevealFilesTreePathOnce(target);
        });
      }
      return;
    }
    const delayMs = REVEAL_READY_BASE_DELAY_MS + attempt * 12;
    await sleep(delayMs);
  }
  // Last chance: allow registry short retries only once.
  revealFilesTreePath(target);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
