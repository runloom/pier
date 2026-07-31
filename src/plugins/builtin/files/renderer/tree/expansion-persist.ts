/**
 * Persist Files tree expansion intents per project root (localStorage).
 * Debounced writes; silent failure when storage is unavailable.
 */
import type { TreeExpansionAuthority } from "@pier/ui/file/tree.tsx";

const STORAGE_PREFIX = "pier.files.tree.expansion.v1:";
const MAX_PATHS = 500;
const WRITE_DEBOUNCE_MS = 300;

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function storageKey(projectRoot: string): string {
  return STORAGE_PREFIX.concat(projectRoot);
}

function trimPaths(paths: readonly string[]): string[] {
  if (paths.length <= MAX_PATHS) {
    return [...paths];
  }
  // Keep shortest paths first (near root) then fill remaining budget.
  const sorted = [...paths].sort(
    (left, right) =>
      left.split("/").length - right.split("/").length ||
      left.localeCompare(right)
  );
  return sorted.slice(0, MAX_PATHS);
}

export function readFilesTreeExpansion(projectRoot: string): unknown {
  const raw = storage()?.getItem(storageKey(projectRoot));
  if (raw == null || raw.length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function writeFilesTreeExpansion(
  projectRoot: string,
  authority: TreeExpansionAuthority
): void {
  const json = authority.toJSON();
  const payload = {
    ...json,
    collapsed: trimPaths(json.collapsed),
    expanded: trimPaths(json.expanded),
  };
  try {
    storage()?.setItem(storageKey(projectRoot), JSON.stringify(payload));
  } catch {
    // Preference persistence must not break the tree.
  }
}

export function bindFilesTreeExpansionPersistence(
  projectRoot: string,
  authority: TreeExpansionAuthority
): () => void {
  const existing = readFilesTreeExpansion(projectRoot);
  if (existing != null) {
    authority.loadJSON(existing, "restore");
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const scheduleWrite = () => {
    if (timer != null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      writeFilesTreeExpansion(projectRoot, authority);
    }, WRITE_DEBOUNCE_MS);
  };

  const unsubscribe = authority.subscribe(scheduleWrite);
  return () => {
    unsubscribe();
    if (timer != null) {
      clearTimeout(timer);
      writeFilesTreeExpansion(projectRoot, authority);
    }
  };
}
