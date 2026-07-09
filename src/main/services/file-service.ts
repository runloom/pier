import { randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  FileCopyRequest,
  FileCopyResult,
  FileEntry,
  FileExistsRequest,
  FileExistsResult,
  FileListRequest,
  FileListResult,
  FileMkdirRequest,
  FileMkdirResult,
  FileMoveRequest,
  FileMoveResult,
  FileReadTextRequest,
  FileRevealRequest,
  FileRevealResult,
  FileStatRequest,
  FileStatResult,
  FileTrashRequest,
  FileTrashResult,
  FileWriteTextRequest,
  FileWriteTextResult,
} from "@shared/contracts/file.ts";

export class FileServiceError extends Error {
  readonly code?: "file_conflict" | "internal_error";

  constructor(
    message: string,
    options?: { code?: "file_conflict" | "internal_error" }
  ) {
    super(message);
    this.name = "FileServiceError";
    if (options?.code) {
      this.code = options.code;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isCrossDeviceError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EXDEV"
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
  copy(request: FileCopyRequest): Promise<FileCopyResult>;
  exists(request: FileExistsRequest): Promise<FileExistsResult>;
  list(request: FileListRequest): Promise<FileListResult>;
  mkdir(request: FileMkdirRequest): Promise<FileMkdirResult>;
  move(request: FileMoveRequest): Promise<FileMoveResult>;
  readText(request: FileReadTextRequest): Promise<string>;
  reveal(request: FileRevealRequest): Promise<FileRevealResult>;
  stat(request: FileStatRequest): Promise<FileStatResult>;
  trash(request: FileTrashRequest): Promise<FileTrashResult>;
  writeText(request: FileWriteTextRequest): Promise<FileWriteTextResult>;
}

export interface FileServiceOptions {
  // 测试注入点:vitest 单测环境没有 electron runtime,也无法稳定制造
  // 跨设备文件系统,注入 fake 才能覆盖 trash 与 move 的 EXDEV 降级分支。
  renameFile?: (source: string, target: string) => Promise<void>;
  revealItem?: (path: string) => void;
  trashItem?: (path: string) => Promise<void>;
}

async function trashViaElectronShell(path: string): Promise<void> {
  // 动态 import 的原因:electron 模块只在 Electron 主进程运行时存在,
  // vitest(纯 Node)里静态导入会直接失败;惰性加载让单测可以导入本模块。
  const { shell } = await import("electron");
  await shell.trashItem(path);
}

function revealViaElectronShell(path: string): void {
  import("electron")
    .then(({ shell }) => {
      shell.showItemInFolder(path);
    })
    .catch(() => undefined);
}

export function createFileService(
  options: FileServiceOptions = {}
): FileService {
  const renameFile = options.renameFile ?? rename;
  const revealItem = options.revealItem ?? revealViaElectronShell;
  const trashItem = options.trashItem ?? trashViaElectronShell;
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
      if (request.expectedMtimeMs != null) {
        try {
          const current = await stat(target);
          if (Math.abs(current.mtimeMs - request.expectedMtimeMs) > 0.5) {
            throw new FileServiceError("file changed on disk", {
              code: "file_conflict",
            });
          }
        } catch (error) {
          if (error instanceof FileServiceError) {
            throw error;
          }
          if (!isMissingPathError(error)) {
            throw error;
          }
          throw new FileServiceError("file changed on disk", {
            code: "file_conflict",
          });
        }
      }
      await mkdir(dirname(target), { recursive: true });
      const tempTarget = `${target}.pier-tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
      await writeFile(tempTarget, request.contents, "utf8");
      try {
        await renameFile(tempTarget, target);
      } catch (error) {
        await rm(tempTarget, { force: true }).catch(() => undefined);
        throw error;
      }
      const writtenStat = await stat(target);
      return {
        mtimeMs: writtenStat.mtimeMs,
        path: request.path,
        root: request.root,
        written: true,
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
      try {
        await renameFile(source, target);
      } catch (error) {
        if (!isCrossDeviceError(error)) {
          throw error;
        }
        // root 内存在 bind-mount / 跨设备子目录时 rename 会抛 EXDEV,
        // 此时降级为「复制 + 删除源」等效完成移动;errorOnExist + force:false
        // 保持与 rename 一致的"不覆盖已存在目标"语义。
        await cp(source, target, {
          errorOnExist: true,
          force: false,
          recursive: true,
        });
        await rm(source, { recursive: true });
      }
      return {
        moved: true,
        newPath: relative(resolve(request.root), target).split(sep).join("/"),
        oldPath: request.path,
        root: request.root,
      };
    },
    async copy(request) {
      const source = await resolveExistingScopedPath(
        request.root,
        request.path
      );
      const target = await resolveWritableScopedPath(
        request.root,
        request.newPath
      );
      await mkdir(dirname(target), { recursive: true });
      // 与 move 一致的"不覆盖已存在目标"语义;目录递归复制。
      await cp(source, target, {
        errorOnExist: true,
        force: false,
        recursive: true,
      });
      return {
        copied: true,
        newPath: relative(resolve(request.root), target).split(sep).join("/"),
        oldPath: request.path,
        root: request.root,
      };
    },
    async reveal(request) {
      const target = await resolveExistingScopedPath(
        request.root,
        request.path
      );
      revealItem(target);
      return {
        path: request.path,
        revealed: true,
        root: request.root,
      };
    },
    async trash(request) {
      const target = await resolveExistingScopedPath(
        request.root,
        request.path
      );
      // 命令名为 trash 就应进系统回收站:直接 rm 是不可恢复的永久删除,
      // 与语义不符;shell.trashItem 让用户可以从回收站找回误删内容。
      await trashItem(target);
      return {
        path: request.path,
        root: request.root,
        trashed: true,
      };
    },
    async mkdir(request) {
      const target = await resolveWritableScopedPath(
        request.root,
        request.path
      );
      // recursive:true 让并发/嵌套创建自动兜底,避免 "父目录不存在" 的 ENOENT,
      // 同时对已存在的目录不抛错(与 UI 语义"确保存在"一致)。
      await mkdir(target, { recursive: true });
      return {
        created: true,
        path: request.path,
        root: request.root,
      };
    },
    async exists(request) {
      try {
        await resolveExistingScopedPath(request.root, request.path);
        return { exists: true, path: request.path, root: request.root };
      } catch (error) {
        if (isMissingPathError(error)) {
          return { exists: false, path: request.path, root: request.root };
        }
        throw error;
      }
    },
    async stat(request) {
      try {
        const target = await resolveExistingScopedPath(
          request.root,
          request.path
        );
        const info = await stat(target);
        return {
          exists: true,
          isDirectory: info.isDirectory(),
          mtimeMs: info.mtimeMs,
          path: request.path,
          root: request.root,
          size: info.size,
        };
      } catch (error) {
        if (isMissingPathError(error)) {
          return {
            exists: false,
            isDirectory: false,
            mtimeMs: null,
            path: request.path,
            root: request.root,
            size: null,
          };
        }
        throw error;
      }
    },
  };
}
