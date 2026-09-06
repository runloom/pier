import { EXPAND_ALL_DEFAULT_MAX_CONCURRENT_LISTS } from "@pier/ui/file/tree-expansion-apply.ts";
import { isFolderAccessBlockedError } from "../editor/errors.ts";
import { collectFilesTreeRestoreDirectoryPaths } from "./expansion-persist.ts";
import {
  type FilesTreeDirectoryLoadDetails,
  type FilesTreeSnapshot,
  invalidateSupersededDirectoryLoads,
  pendingRetainPathSet,
  toFilesTreeErrorMessage,
} from "./load-support.ts";
import {
  entriesByPath,
  mergeDirectoryEntries,
  pruneDirectoryStatesForMissingEntries,
} from "./store-ops.ts";
import type { FilesTreeList } from "./visibility.ts";

/**
 * 预取总预算：超时后仍揭开骨架，在途 listing 可继续填树。
 * 避免任一 list hang 把冷启动钉死在 skeleton。
 */
export const FILES_TREE_RESTORE_EXPAND_TIMEOUT_MS = 800;

interface RootLoadSession {
  directoryLoadGenerations: Map<string, number>;
  directoryLoadPromises: Map<string, Promise<FilesTreeDirectoryLoadDetails>>;
  rootLoadGeneration: number;
  rootLoadPromise: Promise<void> | null;
  snapshot: FilesTreeSnapshot;
  visibilityPredicate: ((path: string) => boolean) | null;
}

type LoadDirectory = (path: string) => Promise<unknown>;

function awaitRestoreOrTimeout(restore: Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, FILES_TREE_RESTORE_EXPAND_TIMEOUT_MS);
    restore.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      }
    );
  });
}

/**
 * 冷启动：在揭开骨架前把落盘展开目录的 listing 预取进 snapshot。
 * 走 loadDirectory（登记 in-flight / loading），与 watch 同生命周期。
 * 无目标时同步返回 undefined，不额外插 microtask（store 单测依赖）。
 */
function restorePersistedExpandedListings(
  session: RootLoadSession,
  root: string,
  list: FilesTreeList,
  loadGeneration: number,
  loadDirectory: LoadDirectory
): Promise<void> | undefined {
  const isVisible = (path: string): boolean =>
    session.visibilityPredicate?.(path) ??
    list.isPathVisible?.(root, path) ??
    true;
  const paths = collectFilesTreeRestoreDirectoryPaths(root, {
    hasRootLevelDirectory: (name) =>
      session.snapshot.entriesByPath.get(name)?.kind === "directory",
    isVisible,
  });
  if (paths.length === 0) {
    return;
  }

  return (async () => {
    let cursor = 0;
    const worker = async () => {
      while (cursor < paths.length) {
        if (session.rootLoadGeneration !== loadGeneration) {
          return;
        }
        const path = paths[cursor];
        cursor += 1;
        if (path === undefined) {
          continue;
        }
        await loadDirectory(path).catch(() => undefined);
      }
    };
    await Promise.all(
      Array.from(
        {
          length: Math.min(
            EXPAND_ALL_DEFAULT_MAX_CONCURRENT_LISTS,
            paths.length
          ),
        },
        () => worker()
      )
    );
  })();
}

export function beginFilesTreeRootLoad(
  session: RootLoadSession,
  root: string,
  list: FilesTreeList,
  fallbackError: string,
  force: boolean,
  emit: () => void,
  loadDirectory: LoadDirectory
): Promise<void> {
  const loadGeneration = session.rootLoadGeneration;
  if (list.isPathVisible) {
    session.visibilityPredicate = (path) =>
      list.isPathVisible?.(root, path) ?? true;
  }
  if (
    (!force &&
      ((session.snapshot.rootLoaded && !session.snapshot.rootError) ||
        session.snapshot.rootLoading ||
        session.rootLoadPromise)) ||
    (force && (session.snapshot.rootLoading || session.rootLoadPromise))
  ) {
    return session.rootLoadPromise ?? Promise.resolve();
  }

  // Hot reload (force): keep prior entries visible while listing. Never emit an
  // empty intermediate map — that collapses maxScrollTop and fights the user.
  const hadLoadedEntries =
    session.snapshot.rootLoaded && session.snapshot.entriesByPath.size > 0;
  session.snapshot = {
    ...session.snapshot,
    rootError: null,
    rootErrorFolderAccessBlocked: false,
    rootLoading: true,
  };
  emit();

  let discarded = false;
  const rootLoadPromise = list(root, { path: "" })
    .then(async (entries) => {
      if (session.rootLoadGeneration !== loadGeneration) {
        discarded = true;
        session.snapshot = { ...session.snapshot, rootLoading: false };
        emit();
        return;
      }
      // Prefer merge whenever we already had a tree: avoids wipe-on-reload and
      // preserves expanded nested listings for dirs still present at root.
      const useMerge = force || hadLoadedEntries;
      const nextEntriesByPath = useMerge
        ? mergeDirectoryEntries(
            session.snapshot.entriesByPath,
            "",
            entries,
            pendingRetainPathSet(root)
          )
        : entriesByPath(entries);
      invalidateSupersededDirectoryLoads(
        session.directoryLoadPromises.keys(),
        session.directoryLoadGenerations,
        nextEntriesByPath,
        ""
      );
      const nextDirectoryStates = useMerge
        ? pruneDirectoryStatesForMissingEntries(
            session.snapshot.directoryStatesByPath,
            nextEntriesByPath,
            ""
          )
        : new Map();
      session.snapshot = {
        directoryStatesByPath: nextDirectoryStates,
        entriesByPath: nextEntriesByPath,
        rootError: null,
        rootErrorFolderAccessBlocked: false,
        rootLoaded: true,
        rootLoading: false,
      };
      const restore = force
        ? undefined
        : restorePersistedExpandedListings(
            session,
            root,
            list,
            loadGeneration,
            loadDirectory
          );
      if (restore === undefined) {
        emit();
        return;
      }
      session.snapshot = {
        ...session.snapshot,
        rootLoaded: false,
        rootLoading: true,
      };
      emit();
      await awaitRestoreOrTimeout(restore);
      if (session.rootLoadGeneration !== loadGeneration) {
        discarded = true;
        session.snapshot = { ...session.snapshot, rootLoading: false };
        emit();
        return;
      }
      session.snapshot = {
        ...session.snapshot,
        rootError: null,
        rootErrorFolderAccessBlocked: false,
        rootLoaded: true,
        rootLoading: false,
      };
      emit();
    })
    .catch((error: unknown) => {
      if (session.rootLoadGeneration !== loadGeneration) {
        discarded = true;
        session.snapshot = { ...session.snapshot, rootLoading: false };
        emit();
        return;
      }
      // Keep prior entries on hot failure; only cold first-load may clear.
      const keepPrior = force || hadLoadedEntries;
      session.snapshot = {
        directoryStatesByPath: keepPrior
          ? session.snapshot.directoryStatesByPath
          : new Map(),
        entriesByPath: keepPrior ? session.snapshot.entriesByPath : new Map(),
        rootError: toFilesTreeErrorMessage(error, fallbackError),
        rootErrorFolderAccessBlocked: isFolderAccessBlockedError(error),
        rootLoaded: true,
        rootLoading: false,
      };
      emit();
    })
    .finally(() => {
      if (session.rootLoadPromise === rootLoadPromise) {
        session.rootLoadPromise = null;
        if (
          discarded &&
          !session.snapshot.rootLoaded &&
          !session.snapshot.rootLoading
        ) {
          // 被失效的加载丢弃且尚无根数据时重发一次，否则树会永久停在
          // skeleton（watch 守卫在 rootLoaded=false 时丢弃所有事件）。
          beginFilesTreeRootLoad(
            session,
            root,
            list,
            fallbackError,
            false,
            emit,
            loadDirectory
          ).catch(() => undefined);
        }
      }
    });
  session.rootLoadPromise = rootLoadPromise;
  return rootLoadPromise;
}
