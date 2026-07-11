import type { PierDirectoryLoadState } from "@pier/ui/file-tree.tsx";
import type { FileEntry } from "@shared/contracts/file.ts";
import { listPendingCreatePaths } from "./files-tree-registry.ts";

export type FilesTreeDirectoryLoadResult =
  | { ok: true }
  | { error: unknown; ok: false };

export interface FilesTreeDirectoryLoadDetails {
  discoveredDirectoryPaths: readonly string[];
  result: FilesTreeDirectoryLoadResult;
}

export interface FilesTreeSnapshot {
  directoryStatesByPath: ReadonlyMap<string, PierDirectoryLoadState>;
  entriesByPath: ReadonlyMap<string, FileEntry>;
  rootError: string | null;
  rootLoaded: boolean;
  rootLoading: boolean;
}

export function pendingRetainPathSet(root: string): ReadonlySet<string> {
  return new Set(listPendingCreatePaths(root));
}

export function toFilesTreeErrorMessage(
  error: unknown,
  fallback: string
): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : fallback;
}

export function invalidateSupersededDirectoryLoads(
  activePaths: Iterable<string>,
  generations: Map<string, number>,
  entries: ReadonlyMap<string, FileEntry>,
  refreshedDirectoryPath: string
): void {
  for (const path of activePaths) {
    const isWithinRefresh =
      refreshedDirectoryPath === "" ||
      path === refreshedDirectoryPath ||
      path.startsWith(`${refreshedDirectoryPath}/`);
    if (isWithinRefresh && entries.get(path)?.kind !== "directory") {
      generations.set(path, (generations.get(path) ?? 0) + 1);
    }
  }
}

export function invalidateDirectoryLoadsIntersectingPath(
  activePaths: Iterable<string>,
  generations: Map<string, number>,
  changedPath: string
): void {
  for (const path of activePaths) {
    if (
      path === changedPath ||
      path.startsWith(`${changedPath}/`) ||
      changedPath.startsWith(`${path}/`)
    ) {
      generations.set(path, (generations.get(path) ?? 0) + 1);
    }
  }
}
