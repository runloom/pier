import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  mkdir,
  open,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type {
  FileConfirmDurabilityRequest,
  FileConfirmDurabilityResult,
  FileDocumentExpectedState,
  FileDocumentWriteResult,
  FileInspectWriteTargetRequest,
} from "@shared/contracts/file.ts";
import {
  type FileRevisionInspection,
  inspectFileRevision,
  isMissingPathError,
  resolveWritableFileIdentity,
  revisionForFileBytes,
  unsupportedFileType,
  type WritableFileIdentity,
} from "./file-path-identity.ts";
import { FilePathTransactionLock } from "./file-path-transaction-lock.ts";

export interface FileSafeWriteRequest {
  bytes: Buffer;
  expected: FileDocumentExpectedState;
  path: string;
  root: string;
}

export interface FileSafeWriter {
  confirmDurability(
    request: FileConfirmDurabilityRequest
  ): Promise<FileConfirmDurabilityResult>;
  inspectRevision(
    request: FileInspectWriteTargetRequest
  ): Promise<FileRevisionInspection>;
  write(request: FileSafeWriteRequest): Promise<FileDocumentWriteResult>;
}

export interface FileSafeWriterOptions {
  /** 测试注入点：在最后一次 revision 校验前制造外部竞态。 */
  beforePublish?: (request: FileSafeWriteRequest) => Promise<void>;
  renameFile?: (source: string, target: string) => Promise<void>;
  syncDirectory?: (directory: string) => Promise<void>;
  transactionLock?: FilePathTransactionLock;
  unlinkFile?: (path: string) => Promise<void>;
}

class FileSafeWriteRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileSafeWriteRefusal";
  }
}

function permissionsMode(mode: number): number {
  return mode % 0o1_0000;
}

const execFileAsync = promisify(execFile);

async function defaultSyncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isPermissionError(error: unknown): error is NodeJS.ErrnoException {
  if (!(error instanceof Error && "code" in error)) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EACCES" || code === "EPERM" || code === "EROFS";
}

async function assertReplaceableMetadata(
  identity: WritableFileIdentity
): Promise<void> {
  const info = identity.stat;
  if (!info) {
    return;
  }
  if (info.nlink > 1) {
    throw new FileSafeWriteRefusal(
      "file has multiple hard links; atomic replacement would break link identity"
    );
  }
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new FileSafeWriteRefusal(
      "file owner cannot be preserved by the current process"
    );
  }
}

interface DarwinMetadataFingerprint {
  acl: string;
  flags: string;
  xattrs: string;
}

async function readDarwinMetadataFingerprint(
  path: string
): Promise<DarwinMetadataFingerprint> {
  const [xattrs, acl, flags] = await Promise.all([
    execFileAsync("/usr/bin/xattr", ["-l", path], { encoding: "utf8" }),
    execFileAsync("/bin/ls", ["-lde", path], { encoding: "utf8" }),
    execFileAsync("/usr/bin/stat", ["-f", "%Sf", path], {
      encoding: "utf8",
    }),
  ]);
  return {
    // 首行包含文件名，后续行才是 ACL 条目；临时路径不同，不能比较首行。
    acl: acl.stdout.split("\n").slice(1).join("\n").trim(),
    flags: flags.stdout.trim(),
    xattrs: xattrs.stdout.trim(),
  };
}

async function copyExistingFileWithMetadata(
  source: string,
  target: string
): Promise<DarwinMetadataFingerprint | null> {
  try {
    if (process.platform !== "darwin") {
      await copyFile(source, target);
      return null;
    }
    const sourceMetadata = await readDarwinMetadataFingerprint(source);
    // macOS 的 /bin/cp -p 保留 mode、owner、group、ACL、file flags、xattr 与
    // resource fork。使用 execFile 参数数组，不经过 shell 或字符串拼接。
    await execFileAsync("/bin/cp", ["-p", source, target], {
      encoding: "utf8",
    });
    return sourceMetadata;
  } catch (error) {
    throw new FileSafeWriteRefusal(
      `file metadata could not be copied safely: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function prepareTemporaryFile(
  identity: WritableFileIdentity,
  temporaryPath: string,
  bytes: Buffer
): Promise<Stats> {
  await assertReplaceableMetadata(identity);
  let sourceMetadata: DarwinMetadataFingerprint | null = null;
  if (identity.exists && identity.stat) {
    sourceMetadata = await copyExistingFileWithMetadata(
      identity.canonicalTarget,
      temporaryPath
    );
    if (process.platform !== "darwin") {
      await chmod(temporaryPath, permissionsMode(identity.stat.mode));
    }
  }
  const handle = await open(
    temporaryPath,
    identity.exists ? "r+" : "wx",
    identity.stat?.mode ?? 0o666
  );
  try {
    await handle.truncate(0);
    await handle.writeFile(bytes);
    if (identity.stat && process.platform !== "darwin") {
      await handle.chmod(permissionsMode(identity.stat.mode));
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  const temporaryStat = await stat(temporaryPath);
  if (identity.stat) {
    if (
      permissionsMode(temporaryStat.mode) !==
        permissionsMode(identity.stat.mode) ||
      temporaryStat.uid !== identity.stat.uid ||
      temporaryStat.gid !== identity.stat.gid
    ) {
      throw new FileSafeWriteRefusal(
        "file mode, owner, or group could not be preserved"
      );
    }
    if (sourceMetadata) {
      let temporaryMetadata: DarwinMetadataFingerprint;
      try {
        temporaryMetadata = await readDarwinMetadataFingerprint(temporaryPath);
      } catch (error) {
        throw new FileSafeWriteRefusal(
          `file metadata could not be verified safely: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      if (
        temporaryMetadata.acl !== sourceMetadata.acl ||
        temporaryMetadata.flags !== sourceMetadata.flags ||
        temporaryMetadata.xattrs !== sourceMetadata.xattrs
      ) {
        throw new FileSafeWriteRefusal(
          "file ACL, flags, or extended attributes could not be preserved"
        );
      }
    }
  }
  return temporaryStat;
}

async function validateExpectedState(
  request: FileSafeWriteRequest
): Promise<
  | { identity: WritableFileIdentity; kind: "ready" }
  | Extract<FileDocumentWriteResult, { kind: "conflict" }>
> {
  const identity = await resolveWritableFileIdentity(
    request.root,
    request.path
  );
  if (request.expected.kind === "absent") {
    return identity.exists
      ? { kind: "conflict", reason: "target-exists" }
      : { identity, kind: "ready" };
  }
  if (!identity.exists) {
    return { kind: "conflict", reason: "target-missing" };
  }
  if (identity.stat && unsupportedFileType(identity.stat)) {
    return { kind: "conflict", reason: "revision-mismatch" };
  }
  const current = await inspectFileRevision(request.root, request.path);
  return current.revision === request.expected.revision
    ? { identity, kind: "ready" }
    : { kind: "conflict", reason: "revision-mismatch" };
}

export function createFileSafeWriter(
  options: FileSafeWriterOptions = {}
): FileSafeWriter {
  const renameFile = options.renameFile ?? rename;
  const syncDirectory = options.syncDirectory ?? defaultSyncDirectory;
  const transactionLock =
    options.transactionLock ?? new FilePathTransactionLock();
  const unlinkFile = options.unlinkFile ?? unlink;

  return {
    async confirmDurability(request) {
      try {
        const initial = await inspectFileRevision(request.root, request.path);
        if (initial.revision !== request.expectedRevision) {
          return { kind: "revision-mismatch" };
        }
        return await transactionLock.run(
          [initial.identity.lexicalTarget, initial.identity.canonicalTarget],
          async (): Promise<FileConfirmDurabilityResult> => {
            const current = await inspectFileRevision(
              request.root,
              request.path
            );
            if (
              current.revision !== request.expectedRevision ||
              current.identity.canonicalTarget !==
                initial.identity.canonicalTarget
            ) {
              return { kind: "revision-mismatch" };
            }
            const handle = await open(current.identity.canonicalTarget, "r");
            try {
              const bytes = await handle.readFile();
              const openedStat = await handle.stat();
              const openedRevision = revisionForFileBytes(
                { ...current.identity, stat: openedStat },
                bytes
              );
              if (openedRevision !== request.expectedRevision) {
                return { kind: "revision-mismatch" };
              }
              await handle.sync();
            } finally {
              await handle.close();
            }
            await syncDirectory(dirname(current.identity.canonicalTarget));
            const final = await inspectFileRevision(request.root, request.path);
            return final.revision === request.expectedRevision
              ? { kind: "confirmed", revision: final.revision }
              : { kind: "revision-mismatch" };
          }
        );
      } catch (error) {
        if (isMissingPathError(error)) {
          return { kind: "revision-mismatch" };
        }
        return {
          kind: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    inspectRevision: (request) =>
      inspectFileRevision(request.root, request.path),
    async write(request) {
      let initial: Awaited<ReturnType<typeof validateExpectedState>>;
      try {
        initial = await validateExpectedState(request);
      } catch (error) {
        if (isPermissionError(error) || error instanceof FileSafeWriteRefusal) {
          return {
            kind: "not-writable",
            message: error.message,
          };
        }
        throw error;
      }
      if (initial.kind === "conflict") {
        return initial;
      }

      return await transactionLock.run(
        [initial.identity.lexicalTarget, initial.identity.canonicalTarget],
        async () => {
          const checked = await validateExpectedState(request);
          if (checked.kind === "conflict") {
            return checked;
          }
          const identity = checked.identity;
          if (identity.stat && unsupportedFileType(identity.stat)) {
            return {
              kind: "not-writable",
              message: "target is not a regular file",
            };
          }

          await mkdir(dirname(identity.canonicalTarget), { recursive: true });
          const temporaryPath = `${identity.canonicalTarget}.pier-tmp-${process.pid}-${randomUUID()}`;
          let committed = false;
          let postCommitCleanupFailed = false;
          try {
            const preparedStat = await prepareTemporaryFile(
              identity,
              temporaryPath,
              request.bytes
            );
            await options.beforePublish?.(request);
            const finalCheck = await validateExpectedState(request);
            if (finalCheck.kind === "conflict") {
              return finalCheck;
            }
            if (
              finalCheck.identity.canonicalTarget !== identity.canonicalTarget
            ) {
              return { kind: "conflict", reason: "revision-mismatch" };
            }

            if (request.expected.kind === "absent") {
              try {
                await link(temporaryPath, identity.canonicalTarget);
              } catch (error) {
                if (
                  error instanceof Error &&
                  "code" in error &&
                  (error as NodeJS.ErrnoException).code === "EEXIST"
                ) {
                  return { kind: "conflict", reason: "target-exists" };
                }
                throw error;
              }
              committed = true;
              try {
                await unlinkFile(temporaryPath);
              } catch {
                postCommitCleanupFailed = true;
              }
            } else {
              await renameFile(temporaryPath, identity.canonicalTarget);
              committed = true;
            }

            let durability: "confirmed" | "unknown" = postCommitCleanupFailed
              ? "unknown"
              : "confirmed";
            try {
              await syncDirectory(dirname(identity.canonicalTarget));
            } catch {
              durability = "unknown";
            }
            const revision = revisionForFileBytes(
              {
                canonicalPath: identity.canonicalPath,
                canonicalTarget: identity.canonicalTarget,
                lexicalTarget: identity.lexicalTarget,
                realRoot: identity.realRoot,
                resolvedRoot: identity.resolvedRoot,
                stat: preparedStat,
                symlinkChain: identity.symlinkChain,
              },
              request.bytes
            );
            return {
              canonicalPath: identity.canonicalPath,
              committed: true,
              durability,
              kind: "written",
              mode: permissionsMode(preparedStat.mode),
              mtimeMs: preparedStat.mtimeMs,
              revision,
              size: preparedStat.size,
            };
          } catch (error) {
            if (
              !committed &&
              (isPermissionError(error) ||
                error instanceof FileSafeWriteRefusal)
            ) {
              return {
                kind: "not-writable",
                message: error instanceof Error ? error.message : String(error),
              };
            }
            throw error;
          } finally {
            await rm(temporaryPath, { force: true }).catch(() => undefined);
          }
        }
      );
    },
  };
}
