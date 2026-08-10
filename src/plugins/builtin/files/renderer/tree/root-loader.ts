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

interface RootLoadSession {
  directoryLoadGenerations: Map<string, number>;
  directoryLoadPromises: Map<string, Promise<FilesTreeDirectoryLoadDetails>>;
  rootLoadGeneration: number;
  rootLoadPromise: Promise<void> | null;
  snapshot: FilesTreeSnapshot;
  visibilityPredicate: ((path: string) => boolean) | null;
}

export function beginFilesTreeRootLoad(
  session: RootLoadSession,
  root: string,
  list: FilesTreeList,
  fallbackError: string,
  force: boolean,
  emit: () => void
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
    rootLoading: true,
  };
  emit();

  let discarded = false;
  const rootLoadPromise = list(root, { path: "" })
    .then((entries) => {
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
      session.snapshot = {
        directoryStatesByPath: useMerge
          ? pruneDirectoryStatesForMissingEntries(
              session.snapshot.directoryStatesByPath,
              nextEntriesByPath,
              ""
            )
          : new Map(),
        entriesByPath: nextEntriesByPath,
        rootError: null,
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
            emit
          ).catch(() => undefined);
        }
      }
    });
  session.rootLoadPromise = rootLoadPromise;
  return rootLoadPromise;
}
