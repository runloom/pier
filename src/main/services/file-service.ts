import { randomUUID } from "node:crypto";
import {
  cp,
  lstat,
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
  FileConfirmDurabilityRequest,
  FileConfirmDurabilityResult,
  FileCopyRequest,
  FileCopyResult,
  FileDocumentReadResult,
  FileDocumentWriteResult,
  FileEntry,
  FileExistsRequest,
  FileExistsResult,
  FileInspectPathImpactRequest,
  FileInspectWriteTargetRequest,
  FileListRequest,
  FileListResult,
  FileMkdirRequest,
  FileMkdirResult,
  FileMoveRequest,
  FileMoveResult,
  FilePathImpact,
  FileReadDocumentRequest,
  FileReadTextRequest,
  FileRevealRequest,
  FileRevealResult,
  FileStatRequest,
  FileStatResult,
  FileTrashRequest,
  FileTrashResult,
  FileWriteDocumentRequest,
  FileWriteTargetInspection,
  FileWriteTextRequest,
  FileWriteTextResult,
} from "@shared/contracts/file.ts";
import {
  encodeFileDocument,
  FileDocumentEncodingError,
} from "./file-document-codec.ts";
import {
  inspectFileWriteTarget,
  readFileDocument,
} from "./file-document-reader.ts";
import { movePathNoReplace } from "./file-move-no-replace.ts";
import { resolveExistingFileIdentity } from "./file-path-identity.ts";
import { FilePathTransactionLock } from "./file-path-transaction-lock.ts";
import {
  createFileSafeWriter,
  type FileSafeWriter,
  type FileSafeWriterOptions,
} from "./file-safe-writer.ts";

export { MAX_EDITABLE_FILE_BYTES } from "./file-document-reader.ts";

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
  confirmDurability(
    request: FileConfirmDurabilityRequest
  ): Promise<FileConfirmDurabilityResult>;
  copy(request: FileCopyRequest): Promise<FileCopyResult>;
  exists(request: FileExistsRequest): Promise<FileExistsResult>;
  inspectPathImpact(
    request: FileInspectPathImpactRequest
  ): Promise<FilePathImpact>;
  inspectWriteTarget(
    request: FileInspectWriteTargetRequest
  ): Promise<FileWriteTargetInspection>;
  list(request: FileListRequest): Promise<FileListResult>;
  mkdir(request: FileMkdirRequest): Promise<FileMkdirResult>;
  move(request: FileMoveRequest): Promise<FileMoveResult>;
  readDocument(
    request: FileReadDocumentRequest
  ): Promise<FileDocumentReadResult>;
  readText(request: FileReadTextRequest): Promise<string>;
  reveal(request: FileRevealRequest): Promise<FileRevealResult>;
  stat(request: FileStatRequest): Promise<FileStatResult>;
  trash(request: FileTrashRequest): Promise<FileTrashResult>;
  writeDocument(
    request: FileWriteDocumentRequest
  ): Promise<FileDocumentWriteResult>;
  writeText(request: FileWriteTextRequest): Promise<FileWriteTextResult>;
}

export interface FileServiceOptions {
  // 测试注入点:vitest 单测环境没有 electron runtime,也无法稳定制造
  // 跨设备文件系统,注入 fake 才能覆盖 trash 与 move 的降级分支。
  moveLinkFile?: (source: string, target: string) => Promise<void>;
  renameFile?: (source: string, target: string) => Promise<void>;
  revealItem?: (path: string) => void;
  safeWriter?: FileSafeWriter;
  safeWriterOptions?: FileSafeWriterOptions;
  transactionLock?: FilePathTransactionLock;
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
  const transactionLock =
    options.transactionLock ?? new FilePathTransactionLock();
  const safeWriter =
    options.safeWriter ??
    createFileSafeWriter({
      ...options.safeWriterOptions,
      renameFile: options.safeWriterOptions?.renameFile ?? renameFile,
      transactionLock,
    });
  return {
    confirmDurability: (request) => safeWriter.confirmDurability(request),
    async inspectPathImpact(request) {
      const { target } = resolveLexicallyScopedPath(request.root, request.path);
      const lexicalInfo = await lstat(target);
      if (lexicalInfo.isSymbolicLink()) {
        return {
          kind: "symlink-entry",
          locatorPrefix: request.path,
          root: request.root,
        };
      }
      const identity = await resolveExistingFileIdentity(
        request.root,
        request.path
      );
      return {
        canonicalBackingPrefix: identity.canonicalPath,
        kind: "regular",
        locatorPrefix: request.path,
        root: request.root,
      };
    },
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
    inspectWriteTarget: (request) =>
      inspectFileWriteTarget(request, safeWriter),
    readDocument: readFileDocument,
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
    async writeDocument(request) {
      try {
        return await safeWriter.write({
          bytes: encodeFileDocument(
            request.contents,
            request.format,
            request.eol
          ),
          expected: request.expected,
          path: request.path,
          root: request.root,
        });
      } catch (error) {
        if (error instanceof FileDocumentEncodingError) {
          return { kind: "not-writable", message: error.message };
        }
        throw error;
      }
    },
    async move(request) {
      const source = resolveLexicallyScopedPath(
        request.root,
        request.path
      ).target;
      const target = resolveLexicallyScopedPath(
        request.root,
        request.newPath
      ).target;
      return await transactionLock.run([source, target], async () => {
        const lockedSource = await resolveExistingScopedPath(
          request.root,
          request.path
        );
        const lockedTarget = await resolveWritableScopedPath(
          request.root,
          request.newPath
        );
        await mkdir(dirname(lockedTarget), { recursive: true });
        await movePathNoReplace(lockedSource, lockedTarget, {
          ...(options.moveLinkFile ? { linkFile: options.moveLinkFile } : {}),
        });
        return {
          moved: true,
          newPath: relative(resolve(request.root), lockedTarget)
            .split(sep)
            .join("/"),
          oldPath: request.path,
          root: request.root,
        };
      });
    },
    async copy(request) {
      const source = resolveLexicallyScopedPath(
        request.root,
        request.path
      ).target;
      const target = resolveLexicallyScopedPath(
        request.root,
        request.newPath
      ).target;
      return await transactionLock.run([source, target], async () => {
        const lockedSource = await resolveExistingScopedPath(
          request.root,
          request.path
        );
        const lockedTarget = await resolveWritableScopedPath(
          request.root,
          request.newPath
        );
        await mkdir(dirname(lockedTarget), { recursive: true });
        await cp(lockedSource, lockedTarget, {
          errorOnExist: true,
          force: false,
          recursive: true,
        });
        return {
          copied: true,
          newPath: relative(resolve(request.root), lockedTarget)
            .split(sep)
            .join("/"),
          oldPath: request.path,
          root: request.root,
        };
      });
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
      const target = resolveLexicallyScopedPath(
        request.root,
        request.path
      ).target;
      return await transactionLock.run([target], async () => {
        const lockedTarget = await resolveExistingScopedPath(
          request.root,
          request.path
        );
        await trashItem(lockedTarget);
        return {
          path: request.path,
          root: request.root,
          trashed: true,
        };
      });
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
