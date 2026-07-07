import type { PierDirectoryLoadState } from "@pier/ui/file-tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEntry } from "@shared/contracts/file.ts";

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

function entriesByPath(entries: readonly FileEntry[]): Map<string, FileEntry> {
  return new Map(entries.map((entry) => [entry.path, entry]));
}

function isDirectoryDescendant(
  entryPath: string,
  directoryPath: string
): boolean {
  return directoryPath === "" || entryPath.startsWith(`${directoryPath}/`);
}

function mergeDirectoryEntries(
  previousEntries: ReadonlyMap<string, FileEntry>,
  directoryPath: string,
  loadedEntries: readonly FileEntry[]
): Map<string, FileEntry> {
  const nextEntries = new Map(previousEntries);

  for (const entryPath of nextEntries.keys()) {
    if (isDirectoryDescendant(entryPath, directoryPath)) {
      nextEntries.delete(entryPath);
    }
  }

  for (const entry of loadedEntries) {
    nextEntries.set(entry.path, entry);
  }

  return nextEntries;
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

export function loadFilesTreeRoot(
  root: string,
  list: FilesListApi,
  fallbackError: string
): void {
  const session = sessionForRoot(root);
  if (
    (session.snapshot.rootLoaded && !session.snapshot.rootError) ||
    session.snapshot.rootLoading ||
    session.rootLoadPromise
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
        directoryStatesByPath: new Map(),
        entriesByPath: entriesByPath(entries),
        rootError: null,
        rootLoaded: true,
        rootLoading: false,
      };
      emit(session);
    })
    .catch((error: unknown) => {
      session.snapshot = {
        directoryStatesByPath: new Map(),
        entriesByPath: new Map(),
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

export async function loadFilesTreeDirectory(
  root: string,
  path: string,
  list: FilesListApi
): Promise<void> {
  const session = sessionForRoot(root);
  session.snapshot = {
    ...session.snapshot,
    directoryStatesByPath: new Map(session.snapshot.directoryStatesByPath).set(
      path,
      "loading"
    ),
  };
  emit(session);

  try {
    const entries = await list(root, { path });
    session.snapshot = {
      ...session.snapshot,
      directoryStatesByPath: new Map(
        session.snapshot.directoryStatesByPath
      ).set(path, entries.length === 0 ? "empty" : "loaded"),
      entriesByPath: mergeDirectoryEntries(
        session.snapshot.entriesByPath,
        path,
        entries
      ),
    };
    emit(session);
  } catch {
    session.snapshot = {
      ...session.snapshot,
      directoryStatesByPath: new Map(
        session.snapshot.directoryStatesByPath
      ).set(path, "error"),
    };
    emit(session);
  }
}

export function clearFilesTreeStore(): void {
  sessions.clear();
}
