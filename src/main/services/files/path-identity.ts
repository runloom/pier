import { createHash } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import { lstat, readlink, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { FileUnsupportedType } from "@shared/contracts/file.ts";

export class FilePathIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilePathIdentityError";
  }
}

export interface FileSymlinkHop {
  path: string;
  target: string;
}

export interface ExistingFileIdentity {
  canonicalPath: string;
  canonicalTarget: string;
  lexicalTarget: string;
  realRoot: string;
  resolvedRoot: string;
  stat: Stats;
  symlinkChain: readonly FileSymlinkHop[];
}

export interface WritableFileIdentity {
  canonicalPath: string;
  canonicalTarget: string;
  exists: boolean;
  lexicalTarget: string;
  realRoot: string;
  resolvedRoot: string;
  stat: Stats | null;
  symlinkChain: readonly FileSymlinkHop[];
}

export interface FileRevisionInspection {
  identity: ExistingFileIdentity;
  revision: string;
}

export function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function assertInsideRoot(root: string, target: string): void {
  const pathFromRoot = relative(root, target);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new FilePathIdentityError("file path escapes root");
  }
}

function toRootRelativePath(root: string, target: string): string {
  return relative(root, target).split(sep).join("/");
}

export function resolveLexicalFilePath(
  root: string,
  path: string
): { lexicalTarget: string; resolvedRoot: string } {
  const resolvedRoot = resolve(root);
  const lexicalTarget = resolve(resolvedRoot, path);
  assertInsideRoot(resolvedRoot, lexicalTarget);
  return { lexicalTarget, resolvedRoot };
}

async function collectSymlinkChain(
  resolvedRoot: string,
  lexicalTarget: string
): Promise<readonly FileSymlinkHop[]> {
  const locator = relative(resolvedRoot, lexicalTarget);
  if (locator.length === 0) {
    return [];
  }
  const segments = locator.split(sep);
  const chain: FileSymlinkHop[] = [];
  let current = resolvedRoot;
  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        chain.push({
          path: toRootRelativePath(resolvedRoot, current),
          target: await readlink(current),
        });
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        break;
      }
      throw error;
    }
  }
  return chain;
}

export async function resolveExistingFileIdentity(
  root: string,
  path: string
): Promise<ExistingFileIdentity> {
  const { lexicalTarget, resolvedRoot } = resolveLexicalFilePath(root, path);
  const realRoot = await realpath(resolvedRoot);
  const canonicalTarget = await realpath(lexicalTarget);
  assertInsideRoot(realRoot, canonicalTarget);
  return {
    canonicalPath: toRootRelativePath(realRoot, canonicalTarget),
    canonicalTarget,
    lexicalTarget,
    realRoot,
    resolvedRoot,
    stat: await stat(canonicalTarget),
    symlinkChain: await collectSymlinkChain(resolvedRoot, lexicalTarget),
  };
}

async function nearestExistingAncestor(target: string): Promise<string> {
  let current = target;
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new FilePathIdentityError("file parent path does not exist");
    }
    current = parent;
  }
}

export async function resolveWritableFileIdentity(
  root: string,
  path: string
): Promise<WritableFileIdentity> {
  const { lexicalTarget, resolvedRoot } = resolveLexicalFilePath(root, path);
  const realRoot = await realpath(resolvedRoot);
  try {
    const existing = await resolveExistingFileIdentity(root, path);
    return { ...existing, exists: true };
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }

  try {
    const lexicalInfo = await lstat(lexicalTarget);
    if (lexicalInfo.isSymbolicLink()) {
      throw new FilePathIdentityError("dangling symbolic link is not writable");
    }
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }

  const ancestor = await nearestExistingAncestor(dirname(lexicalTarget));
  const canonicalAncestor = await realpath(ancestor);
  assertInsideRoot(realRoot, canonicalAncestor);
  const canonicalTarget = resolve(
    canonicalAncestor,
    relative(ancestor, lexicalTarget)
  );
  assertInsideRoot(realRoot, canonicalTarget);
  return {
    canonicalPath: toRootRelativePath(realRoot, canonicalTarget),
    canonicalTarget,
    exists: false,
    lexicalTarget,
    realRoot,
    resolvedRoot,
    stat: null,
    symlinkChain: await collectSymlinkChain(resolvedRoot, lexicalTarget),
  };
}

export function unsupportedFileType(info: Stats): FileUnsupportedType | null {
  if (info.isDirectory()) {
    return "directory";
  }
  if (info.isFIFO()) {
    return "fifo";
  }
  if (info.isSocket()) {
    return "socket";
  }
  if (info.isBlockDevice() || info.isCharacterDevice()) {
    return "device";
  }
  return info.isFile() ? null : "device";
}

async function contentDigest(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk as Buffer);
  }
  return digest.digest("hex");
}

function revisionFor(
  identity: ExistingFileIdentity,
  contentsSha256: string
): string {
  const info = identity.stat;
  const payload = JSON.stringify({
    canonicalPath: identity.canonicalPath,
    contentsSha256,
    dev: info.dev,
    gid: info.gid,
    ino: info.ino,
    mode: info.mode,
    nlink: info.nlink,
    size: info.size,
    symlinkChain: identity.symlinkChain,
    uid: info.uid,
  });
  return `file-v1:${createHash("sha256").update(payload).digest("hex")}`;
}

export function revisionForFileBytes(
  identity: ExistingFileIdentity,
  bytes: Buffer
): string {
  return revisionFor(
    identity,
    createHash("sha256").update(bytes).digest("hex")
  );
}

function sameFileSnapshot(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

export async function inspectFileRevision(
  root: string,
  path: string
): Promise<FileRevisionInspection> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const identity = await resolveExistingFileIdentity(root, path);
    if (unsupportedFileType(identity.stat)) {
      throw new FilePathIdentityError("revision requires a regular file");
    }
    const digest = await contentDigest(identity.canonicalTarget);
    const after = await stat(identity.canonicalTarget);
    if (sameFileSnapshot(identity.stat, after)) {
      return { identity, revision: revisionFor(identity, digest) };
    }
  }
  throw new FilePathIdentityError("file changed while calculating revision");
}
