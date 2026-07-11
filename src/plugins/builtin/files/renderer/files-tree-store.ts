import type { FileEntry } from "@shared/contracts/file.ts";
import {
  loadCompactDirectoryBranch,
  mergeLoadedDirectoryBranch,
} from "./files-tree-directory-loader.ts";
import {
  type FilesTreeDirectoryLoadDetails,
  type FilesTreeDirectoryLoadResult,
  type FilesTreeSnapshot,
  invalidateDirectoryLoadsIntersectingPath,
  invalidateSupersededDirectoryLoads,
  pendingRetainPathSet,
} from "./files-tree-load-support.ts";
import { beginFilesTreeRootLoad } from "./files-tree-root-loader.ts";
import {
  addEntry,
  markParentEmptyAfterChildRemove,
  markParentLoadedAfterChildAdd,
  moveDirectoryStatesSubtree,
  moveEntrySubtree,
  removeDirectoryStatesSubtree,
  removeEntrySubtree,
  setDirectoryState,
} from "./files-tree-store-ops.ts";
import type { FilesTreeList } from "./files-tree-visibility.ts";

type Listener = () => void;

export type {
  FilesTreeDirectoryLoadDetails,
  FilesTreeDirectoryLoadResult,
} from "./files-tree-load-support.ts";

interface FilesTreeSession {
  directoryLoadGenerations: Map<string, number>;
  directoryLoadPromises: Map<string, Promise<FilesTreeDirectoryLoadDetails>>;
  listeners: Set<Listener>;
  rootLoadGeneration: number;
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
    directoryLoadGenerations: new Map(),
    directoryLoadPromises: new Map(),
    listeners: new Set(),
    rootLoadPromise: null,
    rootLoadGeneration: 0,
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

function invalidateLoadsForPathMutation(
  session: FilesTreeSession,
  path: string
): void {
  invalidateDirectoryLoadsIntersectingPath(
    session.directoryLoadPromises.keys(),
    session.directoryLoadGenerations,
    path
  );
  if (session.rootLoadPromise) {
    session.rootLoadGeneration += 1;
  }
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
  return beginFilesTreeRootLoad(session, root, list, fallbackError, force, () =>
    emit(session)
  );
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

export function getPendingFilesTreeRootLoad(
  root: string
): Promise<void> | null {
  return sessionForRoot(root).rootLoadPromise;
}

export async function loadFilesTreeDirectory(
  root: string,
  path: string,
  list: FilesTreeList
): Promise<FilesTreeDirectoryLoadResult> {
  return (await loadFilesTreeDirectoryWithDiscovery(root, path, list)).result;
}

export function getPendingFilesTreeDirectoryLoad(
  root: string,
  path: string
): Promise<FilesTreeDirectoryLoadDetails> | undefined {
  return sessionForRoot(root).directoryLoadPromises.get(path);
}

export async function loadFilesTreeDirectoryWithDiscovery(
  root: string,
  path: string,
  list: FilesTreeList
): Promise<FilesTreeDirectoryLoadDetails> {
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
): Promise<FilesTreeDirectoryLoadDetails> {
  const loadGeneration = session.directoryLoadGenerations.get(path) ?? 0;
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
  const discoveredDirectoryPaths = branch.listings.flatMap((listing) =>
    listing.entries
      .filter((entry) => entry.kind === "directory")
      .map((entry) => entry.path)
  );
  const result: FilesTreeDirectoryLoadResult =
    branch.failedPath === undefined
      ? { ok: true }
      : { error: branch.error, ok: false };
  if ((session.directoryLoadGenerations.get(path) ?? 0) !== loadGeneration) {
    if (session.snapshot.directoryStatesByPath.get(path) === "loading") {
      const hasDescendant = [...session.snapshot.entriesByPath.keys()].some(
        (entryPath) => entryPath.startsWith(`${path}/`)
      );
      session.snapshot = {
        ...session.snapshot,
        directoryStatesByPath: setDirectoryState(
          session.snapshot.directoryStatesByPath,
          path,
          hasDescendant ? "loaded" : "unloaded"
        ),
      };
      emit(session);
    }
    return { discoveredDirectoryPaths, result };
  }
  const { directoryStatesByPath, entriesByPath } = mergeLoadedDirectoryBranch({
    branch,
    directoryStatesByPath: session.snapshot.directoryStatesByPath,
    entriesByPath: session.snapshot.entriesByPath,
    retainPaths: pendingRetainPathSet(root),
  });
  invalidateSupersededDirectoryLoads(
    session.directoryLoadPromises.keys(),
    session.directoryLoadGenerations,
    entriesByPath,
    path
  );
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
  return {
    discoveredDirectoryPaths,
    result,
  };
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
  invalidateLoadsForPathMutation(session, path);
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
  invalidateLoadsForPathMutation(session, oldPath);
  invalidateLoadsForPathMutation(session, newPath);
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
    if (prior === "loading") {
      directoryStatesByPath = setDirectoryState(
        directoryStatesByPath,
        newPath,
        "unloaded"
      );
    } else if (prior == null || prior === "unloaded") {
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
