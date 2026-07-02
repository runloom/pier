import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  FileEntry,
  FileListRequest,
  FileListResult,
  FileMoveRequest,
  FileMoveResult,
  FileReadTextRequest,
  FileRenameRequest,
  FileRenameResult,
  FileTrashRequest,
  FileTrashResult,
  FileWriteTextRequest,
  FileWriteTextResult,
} from "@shared/contracts/file.ts";

export class FileServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileServiceError";
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function assertPathInsideRoot(root: string, target: string): void {
  const pathFromRoot = relative(root, target);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new FileServiceError("file path escapes root");
  }
}

function resolveLexicallyScopedPath(
  root: string,
  path: string
): { resolvedRoot: string; target: string } {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, path);
  assertPathInsideRoot(resolvedRoot, target);
  return { resolvedRoot, target };
}

async function resolveExistingScopedPath(
  root: string,
  path: string
): Promise<string> {
  const { resolvedRoot, target } = resolveLexicallyScopedPath(root, path);
  const realRoot = await realpath(resolvedRoot);
  const realTarget = await realpath(target);
  assertPathInsideRoot(realRoot, realTarget);
  return target;
}

async function assertWritableParentInsideRoot(
  realRoot: string,
  target: string
): Promise<void> {
  let ancestor = dirname(target);
  while (true) {
    try {
      const realAncestor = await realpath(ancestor);
      assertPathInsideRoot(realRoot, realAncestor);
      return;
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      const parent = dirname(ancestor);
      if (parent === ancestor) {
        throw new FileServiceError("file parent path does not exist");
      }
      ancestor = parent;
    }
  }
}

async function resolveWritableScopedPath(
  root: string,
  path: string
): Promise<string> {
  const { resolvedRoot, target } = resolveLexicallyScopedPath(root, path);
  const realRoot = await realpath(resolvedRoot);
  try {
    const realTarget = await realpath(target);
    assertPathInsideRoot(realRoot, realTarget);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    await assertWritableParentInsideRoot(realRoot, target);
  }
  return target;
}

export interface FileService {
  list(request: FileListRequest): Promise<FileListResult>;
  move(request: FileMoveRequest): Promise<FileMoveResult>;
  readText(request: FileReadTextRequest): Promise<string>;
  rename(request: FileRenameRequest): Promise<FileRenameResult>;
  trash(request: FileTrashRequest): Promise<FileTrashResult>;
  writeText(request: FileWriteTextRequest): Promise<FileWriteTextResult>;
}

export function createFileService(): FileService {
  return {
    async list(request) {
      const target = await resolveExistingScopedPath(
        request.root,
        request.path
      );
      const entries = await readdir(target, { withFileTypes: true });
      return entries
        .map<FileEntry>((entry) => {
          const path = request.path
            ? `${request.path}/${entry.name}`
            : entry.name;
          return {
            kind: entry.isDirectory() ? "directory" : "file",
            path,
            root: request.root,
          };
        })
        .sort((left, right) => left.path.localeCompare(right.path));
    },
    async readText(request) {
      return await readFile(
        await resolveExistingScopedPath(request.root, request.path),
        "utf8"
      );
    },
    async writeText(request) {
      const target = await resolveWritableScopedPath(
        request.root,
        request.path
      );
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, request.contents, "utf8");
      return {
        path: request.path,
        root: request.root,
        written: true,
      };
    },
    async rename(request) {
      const source = await resolveExistingScopedPath(
        request.root,
        request.path
      );
      const target = await resolveWritableScopedPath(
        request.root,
        request.newPath
      );
      await mkdir(dirname(target), { recursive: true });
      await rename(source, target);
      return {
        newPath: relative(resolve(request.root), target).split(sep).join("/"),
        oldPath: request.path,
        renamed: true,
        root: request.root,
      };
    },
    async move(request) {
      const source = await resolveExistingScopedPath(
        request.root,
        request.path
      );
      const target = await resolveWritableScopedPath(
        request.root,
        request.newPath
      );
      await mkdir(dirname(target), { recursive: true });
      await rename(source, target);
      return {
        moved: true,
        newPath: relative(resolve(request.root), target).split(sep).join("/"),
        oldPath: request.path,
        root: request.root,
      };
    },
    async trash(request) {
      await rm(await resolveExistingScopedPath(request.root, request.path), {
        force: false,
        recursive: true,
      });
      return {
        path: request.path,
        root: request.root,
        trashed: true,
      };
    },
  };
}
