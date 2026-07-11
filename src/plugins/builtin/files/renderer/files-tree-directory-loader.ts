import type { PierDirectoryLoadState } from "@pier/ui/file-tree.tsx";
import type { FileEntry } from "@shared/contracts/file.ts";
import {
  mergeDirectoryEntries,
  pruneDirectoryStatesForMissingEntries,
  setDirectoryState,
} from "./files-tree-store-ops.ts";
import type { FilesTreeList } from "./files-tree-visibility.ts";

const MAX_COMPACT_DIRECTORY_DEPTH = 64;

export interface LoadedDirectoryListing {
  entries: readonly FileEntry[];
  path: string;
}

export interface LoadedDirectoryBranch {
  error?: unknown;
  failedPath?: string;
  listings: readonly LoadedDirectoryListing[];
}

export interface MergedDirectoryBranch {
  directoryStatesByPath: ReadonlyMap<string, PierDirectoryLoadState>;
  entriesByPath: ReadonlyMap<string, FileEntry>;
}

export async function loadCompactDirectoryBranch(options: {
  isKnownLoaded: (path: string) => boolean;
  list: FilesTreeList;
  path: string;
  root: string;
}): Promise<LoadedDirectoryBranch> {
  const listings: LoadedDirectoryListing[] = [];
  let currentPath = options.path;
  try {
    for (let depth = 0; depth < MAX_COMPACT_DIRECTORY_DEPTH; depth += 1) {
      const entries = await options.list(options.root, { path: currentPath });
      listings.push({ entries, path: currentPath });
      const onlyChild = entries.length === 1 ? entries[0] : undefined;
      if (
        onlyChild?.kind !== "directory" ||
        options.isKnownLoaded(onlyChild.path)
      ) {
        break;
      }
      currentPath = onlyChild.path;
    }
    return { listings };
  } catch (error) {
    return { error, failedPath: currentPath, listings };
  }
}

export function mergeLoadedDirectoryBranch(options: {
  branch: LoadedDirectoryBranch;
  directoryStatesByPath: ReadonlyMap<string, PierDirectoryLoadState>;
  entriesByPath: ReadonlyMap<string, FileEntry>;
  retainPaths: ReadonlySet<string>;
}): MergedDirectoryBranch {
  let entriesByPath = options.entriesByPath;
  let directoryStatesByPath = options.directoryStatesByPath;

  for (const listing of options.branch.listings) {
    entriesByPath = mergeDirectoryEntries(
      entriesByPath,
      listing.path,
      listing.entries,
      options.retainPaths
    );
    const hasVisibleChildren =
      listing.entries.length > 0 ||
      [...options.retainPaths].some(
        (retainPath) =>
          retainPath === listing.path ||
          (listing.path === ""
            ? retainPath.length > 0
            : retainPath.startsWith(`${listing.path}/`))
      );
    directoryStatesByPath = setDirectoryState(
      directoryStatesByPath,
      listing.path,
      hasVisibleChildren ? "loaded" : "empty"
    );
    directoryStatesByPath = pruneDirectoryStatesForMissingEntries(
      directoryStatesByPath,
      entriesByPath,
      listing.path
    );
  }

  if (options.branch.failedPath !== undefined) {
    directoryStatesByPath = setDirectoryState(
      directoryStatesByPath,
      options.branch.failedPath,
      "error"
    );
  }

  return { directoryStatesByPath, entriesByPath };
}
