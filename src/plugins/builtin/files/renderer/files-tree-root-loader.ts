import {
  type FilesTreeDirectoryLoadDetails,
  type FilesTreeSnapshot,
  invalidateSupersededDirectoryLoads,
  pendingRetainPathSet,
  toFilesTreeErrorMessage,
} from "./files-tree-load-support.ts";
import {
  entriesByPath,
  mergeDirectoryEntries,
  pruneDirectoryStatesForMissingEntries,
} from "./files-tree-store-ops.ts";
import type { FilesTreeList } from "./files-tree-visibility.ts";

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

  session.snapshot = {
    ...session.snapshot,
    rootError: null,
    rootLoading: true,
  };
  emit();

  const rootLoadPromise = list(root, { path: "" })
    .then((entries) => {
      if (session.rootLoadGeneration !== loadGeneration) {
        session.snapshot = { ...session.snapshot, rootLoading: false };
        emit();
        return;
      }
      const nextEntriesByPath = force
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
        directoryStatesByPath: force
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
        session.snapshot = { ...session.snapshot, rootLoading: false };
        emit();
        return;
      }
      session.snapshot = {
        directoryStatesByPath: force
          ? session.snapshot.directoryStatesByPath
          : new Map(),
        entriesByPath: force ? session.snapshot.entriesByPath : new Map(),
        rootError: toFilesTreeErrorMessage(error, fallbackError),
        rootLoaded: true,
        rootLoading: false,
      };
      emit();
    })
    .finally(() => {
      if (session.rootLoadPromise === rootLoadPromise) {
        session.rootLoadPromise = null;
      }
    });
  session.rootLoadPromise = rootLoadPromise;
  return rootLoadPromise;
}
