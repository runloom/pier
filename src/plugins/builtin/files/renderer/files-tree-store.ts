import type { PierDirectoryLoadState } from "@pier/ui/file-tree.tsx";
import type { FileEntry } from "@shared/contracts/file.ts";
import {
  loadCompactDirectoryBranch,
  mergeLoadedDirectoryBranch,
} from "./files-tree-directory-loader.ts";
import { listPendingCreatePaths } from "./files-tree-registry.ts";
import {
  addEntry,
  entriesByPath,
  markParentEmptyAfterChildRemove,
  markParentLoadedAfterChildAdd,
  mergeDirectoryEntries,
  moveDirectoryStatesSubtree,
  moveEntrySubtree,
  pruneDirectoryStatesForMissingEntries,
  removeDirectoryStatesSubtree,
  removeEntrySubtree,
  setDirectoryState,
} from "./files-tree-store-ops.ts";
import type { FilesTreeList } from "./files-tree-visibility.ts";

function pendingRetainPathSet(root: string): ReadonlySet<string> {
  return new Set(listPendingCreatePaths(root));
}

interface FilesTreeSnapshot {
  directoryStatesByPath: ReadonlyMap<string, PierDirectoryLoadState>;
  entriesByPath: ReadonlyMap<string, FileEntry>;
  rootError: string | null;
  rootLoaded: boolean;
  rootLoading: boolean;
}

type Listener = () => void;

export type FilesTreeDirectoryLoadResult =
  | { ok: true }
  | { error: unknown; ok: false };

interface FilesTreeSession {
  directoryLoadPromises: Map<string, Promise<FilesTreeDirectoryLoadResult>>;
  listeners: Set<Listener>;
  rootLoadPromise: Promise<void> | null;
  snapshot: FilesTreeSnapshot;
  visibilityPredicate: ((path: string) => boolean) | null;
}

const EMPTY_SNAPSHOT: FilesTreeSnapshot = {
  directoryStatesByPath: new Map(),
  entriesByPath: new Map(),
  rootError: null,
  rootLoaded: false,
  rootLoading: false,
};

const sessions = new Map<string, FilesTreeSession>();

function createSession(): FilesTreeSession {
  return {
    directoryLoadPromises: new Map(),
    listeners: new Set(),
    rootLoadPromise: null,
    snapshot: EMPTY_SNAPSHOT,
    visibilityPredicate: null,
  };
}

function sessionForRoot(root: string): FilesTreeSession {
  const existingSession = sessions.get(root);
  if (existingSession) {
    return existingSession;
  }

  const session = createSession();
  sessions.set(root, session);
  return session;
}

function emit(session: FilesTreeSession): void {
  for (const listener of session.listeners) {
    listener();
  }
}

function emitSnapshotIfChanged(
  session: FilesTreeSession,
  snapshot: FilesTreeSnapshot
): void {
  if (snapshot === session.snapshot) {
    return;
  }

  session.snapshot = snapshot;
  emit(session);
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : fallback;
}

export function getFilesTreeSnapshot(root: string | null): FilesTreeSnapshot {
  if (!root) {
    return EMPTY_SNAPSHOT;
  }
  return sessionForRoot(root).snapshot;
}

export function subscribeFilesTreeSession(
  root: string | null,
  listener: Listener
): () => void {
  if (!root) {
    return () => undefined;
  }

  const session = sessionForRoot(root);
  session.listeners.add(listener);
  return () => {
    session.listeners.delete(listener);
  };
}

function beginRootLoad(
  root: string,
  list: FilesTreeList,
  fallbackError: string,
  force: boolean
): Promise<void> {
  const session = sessionForRoot(root);
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
  emit(session);

  const rootLoadPromise = list(root, { path: "" })
    .then((entries) => {
      const nextEntriesByPath = force
        ? mergeDirectoryEntries(
            session.snapshot.entriesByPath,
            "",
            entries,
            pendingRetainPathSet(root)
          )
        : entriesByPath(entries);
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
      emit(session);
    })
    .catch((error: unknown) => {
      session.snapshot = {
        directoryStatesByPath: force
          ? session.snapshot.directoryStatesByPath
          : new Map(),
        entriesByPath: force ? session.snapshot.entriesByPath : new Map(),
        rootError: toErrorMessage(error, fallbackError),
        rootLoaded: true,
        rootLoading: false,
      };
      emit(session);
    })
    .finally(() => {
      if (session.rootLoadPromise === rootLoadPromise) {
        session.rootLoadPromise = null;
      }
    });
  session.rootLoadPromise = rootLoadPromise;
  return rootLoadPromise;
}

export function loadFilesTreeRoot(
  root: string,
  list: FilesTreeList,
  fallbackError: string
): Promise<void> {
  return beginRootLoad(root, list, fallbackError, false);
}

export function reloadFilesTreeRoot(
  root: string,
  list: FilesTreeList,
  fallbackError: string
): Promise<void> {
  return beginRootLoad(root, list, fallbackError, true);
}

export async function loadFilesTreeDirectory(
  root: string,
  path: string,
  list: FilesTreeList
): Promise<FilesTreeDirectoryLoadResult> {
  const session = sessionForRoot(root);
  if (list.isPathVisible) {
    session.visibilityPredicate = (candidatePath) =>
      list.isPathVisible?.(root, candidatePath) ?? true;
  }
  const activeLoad = session.directoryLoadPromises.get(path);
  if (activeLoad) {
    return await activeLoad;
  }

  const loadPromise = loadFilesTreeDirectoryBranch(session, root, path, list);
  session.directoryLoadPromises.set(path, loadPromise);
  try {
    return await loadPromise;
  } finally {
    if (session.directoryLoadPromises.get(path) === loadPromise) {
      session.directoryLoadPromises.delete(path);
    }
  }
}

async function loadFilesTreeDirectoryBranch(
  session: FilesTreeSession,
  root: string,
  path: string,
  list: FilesTreeList
): Promise<FilesTreeDirectoryLoadResult> {
  const loadingStates = setDirectoryState(
    session.snapshot.directoryStatesByPath,
    path,
    "loading"
  );
  if (
    session.snapshot.directoryStatesByPath.get(path) !== "loaded" &&
    session.snapshot.directoryStatesByPath.get(path) !== "empty" &&
    loadingStates !== session.snapshot.directoryStatesByPath
  ) {
    session.snapshot = {
      ...session.snapshot,
      directoryStatesByPath: loadingStates,
    };
    emit(session);
  }

  const branch = await loadCompactDirectoryBranch({
    isKnownLoaded: (candidatePath) => {
      const state = session.snapshot.directoryStatesByPath.get(candidatePath);
      return state === "loaded" || state === "empty";
    },
    list,
    path,
    root,
  });
  const { directoryStatesByPath, entriesByPath } = mergeLoadedDirectoryBranch({
    branch,
    directoryStatesByPath: session.snapshot.directoryStatesByPath,
    entriesByPath: session.snapshot.entriesByPath,
    retainPaths: pendingRetainPathSet(root),
  });
  emitSnapshotIfChanged(
    session,
    directoryStatesByPath === session.snapshot.directoryStatesByPath &&
      entriesByPath === session.snapshot.entriesByPath
      ? session.snapshot
      : {
          ...session.snapshot,
          directoryStatesByPath,
          entriesByPath,
        }
  );
  return branch.failedPath === undefined
    ? { ok: true }
    : { error: branch.error, ok: false };
}

export function addFilesTreeEntry(root: string, entry: FileEntry): void {
  const session = sessionForRoot(root);
  if (session.visibilityPredicate?.(entry.path) === false) {
    return;
  }
  const entriesByPath = addEntry(session.snapshot.entriesByPath, entry);
  let directoryStatesByPath = markParentLoadedAfterChildAdd(
    session.snapshot.directoryStatesByPath,
    entry.path
  );
  // 新建空目录:直接 empty,避免 hasChildren:unknown → unloaded 再点一次才 Empty。
  if (entry.kind === "directory") {
    directoryStatesByPath = setDirectoryState(
      directoryStatesByPath,
      entry.path,
      "empty"
    );
  }
  emitSnapshotIfChanged(
    session,
    entriesByPath === session.snapshot.entriesByPath &&
      directoryStatesByPath === session.snapshot.directoryStatesByPath
      ? session.snapshot
      : {
          ...session.snapshot,
          directoryStatesByPath,
          entriesByPath,
        }
  );
}

/** 嵌套创建时补齐缺失的中间目录节点,并标为 loaded(已知有子项)。 */
export function ensureAncestorDirectoryEntries(
  root: string,
  relativePath: string
): void {
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return;
  }
  const session = sessionForRoot(root);
  let entriesByPath = session.snapshot.entriesByPath;
  let directoryStatesByPath = session.snapshot.directoryStatesByPath;
  let changed = false;
  for (let index = 1; index < segments.length; index += 1) {
    const ancestorPath = segments.slice(0, index).join("/");
    if (session.visibilityPredicate?.(ancestorPath) === false) {
      continue;
    }
    if (!entriesByPath.has(ancestorPath)) {
      entriesByPath = addEntry(entriesByPath, {
        kind: "directory",
        path: ancestorPath,
        root,
      });
      changed = true;
    }
    const state = directoryStatesByPath.get(ancestorPath);
    if (state !== "loaded" && state !== "empty") {
      directoryStatesByPath = setDirectoryState(
        directoryStatesByPath,
        ancestorPath,
        "loaded"
      );
      changed = true;
    }
  }
  if (!changed) {
    return;
  }
  emitSnapshotIfChanged(session, {
    ...session.snapshot,
    directoryStatesByPath,
    entriesByPath,
  });
}

export function removeFilesTreeEntry(root: string, path: string): void {
  const session = sessionForRoot(root);
  const entriesByPath = removeEntrySubtree(
    session.snapshot.entriesByPath,
    path
  );
  const directoryStatesWithoutRemovedPath = removeDirectoryStatesSubtree(
    session.snapshot.directoryStatesByPath,
    path
  );
  const directoryStatesByPath = markParentEmptyAfterChildRemove(
    directoryStatesWithoutRemovedPath,
    entriesByPath,
    path
  );
  emitSnapshotIfChanged(
    session,
    entriesByPath === session.snapshot.entriesByPath &&
      directoryStatesByPath === session.snapshot.directoryStatesByPath
      ? session.snapshot
      : {
          ...session.snapshot,
          directoryStatesByPath,
          entriesByPath,
        }
  );
}

export function moveFilesTreeEntry(
  root: string,
  oldPath: string,
  newPath: string
): void {
  const session = sessionForRoot(root);
  if (session.visibilityPredicate?.(newPath) === false) {
    removeFilesTreeEntry(root, oldPath);
    return;
  }
  const entriesByPath = moveEntrySubtree(
    session.snapshot.entriesByPath,
    oldPath,
    newPath
  );
  const movedDirectoryStatesByPath = moveDirectoryStatesSubtree(
    session.snapshot.directoryStatesByPath,
    oldPath,
    newPath
  );
  const sourceParentUpdatedStates = markParentEmptyAfterChildRemove(
    movedDirectoryStatesByPath,
    entriesByPath,
    oldPath
  );
  let directoryStatesByPath = markParentLoadedAfterChildAdd(
    sourceParentUpdatedStates,
    newPath
  );
  const movedEntry = entriesByPath.get(newPath);
  if (movedEntry?.kind === "directory") {
    const prior = directoryStatesByPath.get(newPath);
    if (prior == null || prior === "unloaded") {
      directoryStatesByPath = setDirectoryState(
        directoryStatesByPath,
        newPath,
        "empty"
      );
    }
  }
  emitSnapshotIfChanged(
    session,
    entriesByPath === session.snapshot.entriesByPath &&
      directoryStatesByPath === session.snapshot.directoryStatesByPath
      ? session.snapshot
      : {
          ...session.snapshot,
          directoryStatesByPath,
          entriesByPath,
        }
  );
}

export function clearFilesTreeStore(): void {
  sessions.clear();
}
