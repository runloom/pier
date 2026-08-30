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

interface FilesTreeRevealWaitTarget {
  fallbackToRoot?: boolean | undefined;
  instanceId?: string | undefined;
  list?: FilesTreeList;
  options?: PierFileTreeRevealOptions | undefined;
  path: string;
  resolveInstanceId?: (() => string) | undefined;
  root: string;
}

function resolveRevealWaitTarget(target: FilesTreeRevealWaitTarget): {
  fallbackToRoot?: boolean | undefined;
  instanceId?: string | undefined;
  options?: PierFileTreeRevealOptions | undefined;
  path: string;
  root: string;
} {
  const instanceId = target.resolveInstanceId?.() ?? target.instanceId;
  return {
    ...(target.fallbackToRoot === undefined
      ? {}
      : { fallbackToRoot: target.fallbackToRoot }),
    ...(instanceId === undefined ? {} : { instanceId }),
    ...(target.options === undefined ? {} : { options: target.options }),
    path: target.path,
    root: target.root,
  };
}

/**
 * Ensure ancestor entries exist, load real directory listings, then reveal
 * after the tree can observe the updated snapshot. Calling reveal in the same
 * turn as ensure/load races the React items→model sync.
 */
export function revealFilesTreePathAfterAncestors(
  target: FilesTreeRevealWaitTarget & { list: FilesTreeList }
): void {
  revealFilesTreePathAfterAncestorsAsync(target).catch(() => undefined);
}

async function revealFilesTreePathAfterAncestorsAsync(
  target: FilesTreeRevealWaitTarget & { list: FilesTreeList }
): Promise<void> {
  await ensureFilesTreeAncestorsLoaded(target);
  await waitUntilRevealReady(target);
}

/** Poll until the tree can reveal, then re-reveal after paint. */
export async function waitUntilRevealReady(
  target: FilesTreeRevealWaitTarget
): Promise<boolean> {
  for (let attempt = 0; attempt < REVEAL_READY_MAX_ATTEMPTS; attempt += 1) {
    // Poll with a single attempt — never schedule registry timeout storms.
    const attemptTarget = resolveRevealWaitTarget(target);
    if (tryRevealFilesTreePathOnce(attemptTarget)) {
      // One paint still races row DOM focus/selection.
      queueMicrotask(() => {
        tryRevealFilesTreePathOnce(resolveRevealWaitTarget(target));
      });
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          tryRevealFilesTreePathOnce(resolveRevealWaitTarget(target));
        });
      }
      return true;
    }
    const delayMs = REVEAL_READY_BASE_DELAY_MS + attempt * 12;
    await sleep(delayMs);
  }
  // Last chance: allow registry short retries only once.
  return revealFilesTreePath(resolveRevealWaitTarget(target));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
