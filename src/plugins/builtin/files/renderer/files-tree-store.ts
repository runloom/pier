import type { PierDirectoryLoadState } from "@pier/ui/file-tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import type { FileWatchEvent } from "@shared/contracts/file-watch.ts";
import { listPendingCreatePaths } from "./files-tree-registry.ts";
import {
  addEntry,
  entriesByPath,
  markParentEmptyAfterChildRemove,
  markParentLoadedAfterChildAdd,
  mergeDirectoryEntries,
  moveDirectoryStatesSubtree,
  moveEntrySubtree,
  parentDirectoryPath,
  pruneDirectoryStatesForMissingEntries,
  removeDirectoryStatesSubtree,
  removeEntrySubtree,
  setDirectoryState,
} from "./files-tree-store-ops.ts";

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

type FilesListApi = RendererPluginContext["files"]["list"];
type Listener = () => void;

interface FilesTreeSession {
  listeners: Set<Listener>;
  rootLoadPromise: Promise<void> | null;
  snapshot: FilesTreeSnapshot;
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
    listeners: new Set(),
    rootLoadPromise: null,
    snapshot: EMPTY_SNAPSHOT,
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
  list: FilesListApi,
  fallbackError: string,
  force: boolean
): void {
  const session = sessionForRoot(root);
  if (
    (!force &&
      ((session.snapshot.rootLoaded && !session.snapshot.rootError) ||
        session.snapshot.rootLoading ||
        session.rootLoadPromise)) ||
    (force && (session.snapshot.rootLoading || session.rootLoadPromise))
  ) {
    return;
  }

  session.snapshot = {
    ...session.snapshot,
    rootError: null,
    rootLoading: true,
  };
  emit(session);

  session.rootLoadPromise = list(root, { path: "" })
    .then((entries) => {
      session.snapshot = {
        directoryStatesByPath: force
          ? session.snapshot.directoryStatesByPath
          : new Map(),
        entriesByPath: force
          ? mergeDirectoryEntries(
              session.snapshot.entriesByPath,
              "",
              entries,
              pendingRetainPathSet(root)
            )
          : entriesByPath(entries),
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
      session.rootLoadPromise = null;
    });
}

export function loadFilesTreeRoot(
  root: string,
  list: FilesListApi,
  fallbackError: string
): void {
  beginRootLoad(root, list, fallbackError, false);
}

export function reloadFilesTreeRoot(
  root: string,
  list: FilesListApi,
  fallbackError: string
): void {
  beginRootLoad(root, list, fallbackError, true);
}

export async function loadFilesTreeDirectory(
  root: string,
  path: string,
  list: FilesListApi
): Promise<void> {
  const session = sessionForRoot(root);
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

  try {
    const entries = await list(root, { path });
    const retainPaths = pendingRetainPathSet(root);
    const mergedEntriesByPath = mergeDirectoryEntries(
      session.snapshot.entriesByPath,
      path,
      entries,
      retainPaths
    );
    const hasVisibleChildren =
      entries.length > 0 ||
      [...retainPaths].some(
        (retainPath) =>
          retainPath === path ||
          (path === ""
            ? retainPath.length > 0
            : retainPath.startsWith(`${path}/`))
      );
    const loadedDirectoryStatesByPath = setDirectoryState(
      session.snapshot.directoryStatesByPath,
      path,
      hasVisibleChildren ? "loaded" : "empty"
    );
    const directoryStatesByPath = pruneDirectoryStatesForMissingEntries(
      loadedDirectoryStatesByPath,
      mergedEntriesByPath,
      path
    );
    const entriesByPath = mergedEntriesByPath;

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
  } catch {
    const directoryStatesByPath = setDirectoryState(
      session.snapshot.directoryStatesByPath,
      path,
      "error"
    );
    emitSnapshotIfChanged(
      session,
      directoryStatesByPath === session.snapshot.directoryStatesByPath
        ? session.snapshot
        : {
            ...session.snapshot,
            directoryStatesByPath,
          }
    );
  }
}

export function addFilesTreeEntry(root: string, entry: FileEntry): void {
  const session = sessionForRoot(root);
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

function parentPathLoaded(snapshot: FilesTreeSnapshot, path: string): boolean {
  const parentPath = parentDirectoryPath(path);
  if (parentPath === null) {
    return snapshot.rootLoaded && !snapshot.rootError;
  }
  const state = snapshot.directoryStatesByPath.get(parentPath);
  return state === "loaded" || state === "empty";
}

export function applyFilesTreeWatchEvent(
  root: string,
  event: FileWatchEvent,
  list: FilesListApi,
  fallbackError: string
): void {
  if (event.root !== root) {
    return;
  }

  const session = sessionForRoot(root);
  let needsRootReload = false;
  const parentsToRefresh = new Set<string>();

  for (const change of event.changes) {
    if (change.path === ".") {
      needsRootReload = true;
      continue;
    }

    if (change.kind === "deleted") {
      if (
        session.snapshot.entriesByPath.has(change.path) ||
        parentPathLoaded(session.snapshot, change.path)
      ) {
        removeFilesTreeEntry(root, change.path);
      }
      continue;
    }

    // created / changed:
    // - 已知 entry 一律不动。macOS fs.watch 会把「目录内子文件写入」上报为
    //   目录自身的 rename/change,若据此覆盖 entry,批次里没有子路径时会把
    //   目录猜成 file,行 remount、展开态丢失(用户看到"展开后没有内容")。
    // - 未知新路径不猜 kind:重新 list 已加载的父目录,kind 来自真实 listing。
    if (session.snapshot.entriesByPath.has(change.path)) {
      continue;
    }
    if (!parentPathLoaded(session.snapshot, change.path)) {
      continue;
    }
    const parentPath = parentDirectoryPath(change.path);
    if (parentPath === null) {
      needsRootReload = true;
    } else {
      parentsToRefresh.add(parentPath);
    }
  }

  for (const parentPath of parentsToRefresh) {
    loadFilesTreeDirectory(root, parentPath, list).catch(() => undefined);
  }
  if (needsRootReload) {
    reloadFilesTreeRoot(root, list, fallbackError);
  }
}

export function clearFilesTreeStore(): void {
  sessions.clear();
}
