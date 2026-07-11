import type { PierDirectoryLoadState } from "@pier/ui/file-tree.tsx";
import type { FileEntry } from "@shared/contracts/file.ts";

export function entriesByPath(
  entries: readonly FileEntry[]
): Map<string, FileEntry> {
  return new Map(entries.map((entry) => [entry.path, entry]));
}

function sameFileEntry(left: FileEntry, right: FileEntry): boolean {
  return (
    left.kind === right.kind &&
    left.path === right.path &&
    left.root === right.root
  );
}

export function setDirectoryState(
  states: ReadonlyMap<string, PierDirectoryLoadState>,
  path: string,
  state: PierDirectoryLoadState
): ReadonlyMap<string, PierDirectoryLoadState> {
  if (states.get(path) === state) {
    return states;
  }
  return new Map(states).set(path, state);
}

function isSamePathOrDescendant(entryPath: string, path: string): boolean {
  return entryPath === path || isDirectoryDescendant(entryPath, path);
}

function rewriteDescendantPath(
  entryPath: string,
  oldPath: string,
  newPath: string
): string {
  if (entryPath === oldPath) {
    return newPath;
  }
  return `${newPath}/${entryPath.slice(oldPath.length + 1)}`;
}

function isDirectoryDescendant(
  entryPath: string,
  directoryPath: string
): boolean {
  return directoryPath === "" || entryPath.startsWith(`${directoryPath}/`);
}

export function parentDirectoryPath(path: string): string | null {
  const slashIndex = path.lastIndexOf("/");
  return slashIndex < 0 ? null : path.slice(0, slashIndex);
}

function hasDescendantEntry(
  entries: ReadonlyMap<string, FileEntry>,
  directoryPath: string
): boolean {
  for (const entryPath of entries.keys()) {
    if (isDirectoryDescendant(entryPath, directoryPath)) {
      return true;
    }
  }
  return false;
}

function directChildPathWithinDirectory(
  directoryPath: string,
  entryPath: string
): string | null {
  if (!isDirectoryDescendant(entryPath, directoryPath)) {
    return null;
  }
  if (directoryPath === "") {
    return entryPath.split("/").at(0) ?? null;
  }
  const childName = entryPath
    .slice(directoryPath.length + 1)
    .split("/")
    .at(0);
  return childName ? `${directoryPath}/${childName}` : null;
}

function shouldRemoveEntryOnDirectoryMerge(
  entryPath: string,
  directoryPath: string,
  loadedEntriesByPath: ReadonlyMap<string, FileEntry>
): boolean {
  if (
    !isDirectoryDescendant(entryPath, directoryPath) ||
    loadedEntriesByPath.has(entryPath)
  ) {
    return false;
  }
  const directChildPath = directChildPathWithinDirectory(
    directoryPath,
    entryPath
  );
  const directChild = directChildPath
    ? loadedEntriesByPath.get(directChildPath)
    : undefined;
  return directChildPath === null || directChild?.kind !== "directory";
}

export function pruneDirectoryStatesForMissingEntries(
  states: ReadonlyMap<string, PierDirectoryLoadState>,
  entries: ReadonlyMap<string, FileEntry>,
  directoryPath: string
): ReadonlyMap<string, PierDirectoryLoadState> {
  let nextStates: Map<string, PierDirectoryLoadState> | null = null;
  for (const statePath of states.keys()) {
    if (
      statePath === directoryPath ||
      !isDirectoryDescendant(statePath, directoryPath) ||
      entries.get(statePath)?.kind === "directory"
    ) {
      continue;
    }
    nextStates ??= new Map(states);
    nextStates.delete(statePath);
  }
  return nextStates ?? states;
}

export function markParentLoadedAfterChildAdd(
  states: ReadonlyMap<string, PierDirectoryLoadState>,
  path: string
): ReadonlyMap<string, PierDirectoryLoadState> {
  const parentPath = parentDirectoryPath(path);
  if (parentPath === null || states.get(parentPath) !== "empty") {
    return states;
  }
  return setDirectoryState(states, parentPath, "loaded");
}

export function markParentEmptyAfterChildRemove(
  states: ReadonlyMap<string, PierDirectoryLoadState>,
  entries: ReadonlyMap<string, FileEntry>,
  path: string
): ReadonlyMap<string, PierDirectoryLoadState> {
  const parentPath = parentDirectoryPath(path);
  if (
    parentPath === null ||
    states.get(parentPath) !== "loaded" ||
    hasDescendantEntry(entries, parentPath)
  ) {
    return states;
  }
  return setDirectoryState(states, parentPath, "empty");
}

export function mergeDirectoryEntries(
  previousEntries: ReadonlyMap<string, FileEntry>,
  directoryPath: string,
  loadedEntries: readonly FileEntry[],
  retainPaths?: ReadonlySet<string>
): ReadonlyMap<string, FileEntry> {
  const loadedEntriesByPath = entriesByPath(loadedEntries);
  let nextEntries: Map<string, FileEntry> | null = null;
  for (const entryPath of previousEntries.keys()) {
    if (retainPaths?.has(entryPath)) {
      continue;
    }
    if (
      shouldRemoveEntryOnDirectoryMerge(
        entryPath,
        directoryPath,
        loadedEntriesByPath
      )
    ) {
      nextEntries ??= new Map(previousEntries);
      nextEntries.delete(entryPath);
    }
  }
  for (const entry of loadedEntries) {
    const existingEntry = previousEntries.get(entry.path);
    const nextEntry =
      existingEntry && sameFileEntry(existingEntry, entry)
        ? existingEntry
        : entry;
    if (existingEntry !== nextEntry) {
      nextEntries ??= new Map(previousEntries);
      nextEntries.set(entry.path, nextEntry);
    }
  }
  return nextEntries ?? previousEntries;
}

export function addEntry(
  previousEntries: ReadonlyMap<string, FileEntry>,
  entry: FileEntry
): ReadonlyMap<string, FileEntry> {
  const existingEntry = previousEntries.get(entry.path);
  if (existingEntry && sameFileEntry(existingEntry, entry)) {
    return previousEntries;
  }
  return new Map(previousEntries).set(entry.path, entry);
}

export function removeEntrySubtree(
  previousEntries: ReadonlyMap<string, FileEntry>,
  path: string
): ReadonlyMap<string, FileEntry> {
  let nextEntries: Map<string, FileEntry> | null = null;
  for (const entryPath of previousEntries.keys()) {
    if (isSamePathOrDescendant(entryPath, path)) {
      nextEntries ??= new Map(previousEntries);
      nextEntries.delete(entryPath);
    }
  }
  return nextEntries ?? previousEntries;
}

export function removeDirectoryStatesSubtree(
  previousStates: ReadonlyMap<string, PierDirectoryLoadState>,
  path: string
): ReadonlyMap<string, PierDirectoryLoadState> {
  let nextStates: Map<string, PierDirectoryLoadState> | null = null;
  for (const statePath of previousStates.keys()) {
    if (isSamePathOrDescendant(statePath, path)) {
      nextStates ??= new Map(previousStates);
      nextStates.delete(statePath);
    }
  }
  return nextStates ?? previousStates;
}

export function moveEntrySubtree(
  previousEntries: ReadonlyMap<string, FileEntry>,
  oldPath: string,
  newPath: string
): ReadonlyMap<string, FileEntry> {
  let changed = false;
  const nextEntries = new Map<string, FileEntry>();
  for (const [entryPath, entry] of previousEntries) {
    if (!isSamePathOrDescendant(entryPath, oldPath)) {
      nextEntries.set(entryPath, entry);
      continue;
    }
    changed = true;
    const rewrittenPath = rewriteDescendantPath(entryPath, oldPath, newPath);
    nextEntries.set(rewrittenPath, { ...entry, path: rewrittenPath });
  }
  return changed ? nextEntries : previousEntries;
}

export function moveDirectoryStatesSubtree(
  previousStates: ReadonlyMap<string, PierDirectoryLoadState>,
  oldPath: string,
  newPath: string
): ReadonlyMap<string, PierDirectoryLoadState> {
  let changed = false;
  const nextStates = new Map<string, PierDirectoryLoadState>();
  for (const [statePath, state] of previousStates) {
    if (!isSamePathOrDescendant(statePath, oldPath)) {
      nextStates.set(statePath, state);
      continue;
    }
    changed = true;
    nextStates.set(rewriteDescendantPath(statePath, oldPath, newPath), state);
  }
  return changed ? nextStates : previousStates;
}
