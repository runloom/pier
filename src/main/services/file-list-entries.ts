import { readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  FileEntry,
  FileListRequest,
  FileListResult,
} from "@shared/contracts/file.ts";

function assertPathInsideRoot(root: string, target: string): void {
  const pathFromRoot = relative(root, target);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error("file path escapes root");
  }
}

/**
 * Classify directory entries for the files tree. Symlinks are typed by their
 * resolved target (directory vs file); broken or out-of-root links are omitted.
 */
export async function listScopedDirectoryEntries(
  request: FileListRequest,
  targetAbsolute: string
): Promise<FileListResult> {
  const realRoot = await realpath(resolve(request.root));
  const entries = await readdir(targetAbsolute, { withFileTypes: true });
  const mapped = await Promise.all(
    entries.map(async (entry): Promise<FileEntry | null> => {
      const path = request.path ? `${request.path}/${entry.name}` : entry.name;
      if (!entry.isSymbolicLink()) {
        return {
          kind: entry.isDirectory() ? "directory" : "file",
          path,
          root: request.root,
        };
      }
      const absolute = join(targetAbsolute, entry.name);
      let real: string;
      try {
        real = await realpath(absolute);
      } catch {
        return null;
      }
      try {
        assertPathInsideRoot(realRoot, real);
      } catch {
        return null;
      }
      try {
        const info = await stat(real);
        return {
          kind: info.isDirectory() ? "directory" : "file",
          path,
          root: request.root,
        };
      } catch {
        return null;
      }
    })
  );
  return mapped
    .filter((entry): entry is FileEntry => entry !== null)
    .sort((left, right) => left.path.localeCompare(right.path));
}
