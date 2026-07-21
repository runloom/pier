import type { Dirent } from "node:fs";
import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assertRealDirectory,
  assertSafeRelativePath,
  comparePaths,
  lstatOrThrow,
  readFileNoFollow,
  sha256Hex,
  timeNs,
  toNumber,
  toPosixRelative,
} from "./import-fs.ts";
import {
  PROJECT_SKILLS_IMPORT_LIMITS,
  ProjectSkillsImportError,
} from "./import-limits.ts";

export type EntrySnapshot =
  | {
      kind: "dir";
      relativePath: string;
      dev: number;
      ino: number;
      mode: number;
      mtimeNs: bigint;
      ctimeNs: bigint;
      childNames: string[];
    }
  | {
      kind: "file";
      relativePath: string;
      dev: number;
      ino: number;
      mode: number;
      size: number;
      mtimeNs: bigint;
      ctimeNs: bigint;
      contentSha256: string;
      executable: boolean;
      bytes: Buffer;
    };

export interface PreparedTree {
  entries: EntrySnapshot[];
  fileCount: number;
  totalBytes: number;
  treeFiles: {
    relativePath: string;
    executable: boolean;
    bytes: Buffer;
  }[];
}

export function snapshotsEqual(
  a: EntrySnapshot[],
  b: EntrySnapshot[]
): boolean {
  if (a.length !== b.length) return false;
  const byPath = new Map(b.map((entry) => [entry.relativePath, entry]));
  for (const left of a) {
    const right = byPath.get(left.relativePath);
    if (!right || left.kind !== right.kind) return false;
    if (left.dev !== right.dev || left.ino !== right.ino) return false;
    if (left.mtimeNs !== right.mtimeNs || left.ctimeNs !== right.ctimeNs) {
      return false;
    }
    if (left.kind === "dir" && right.kind === "dir") {
      if (left.childNames.join("\0") !== right.childNames.join("\0")) {
        return false;
      }
      continue;
    }
    if (
      left.kind === "file" &&
      right.kind === "file" &&
      (left.size !== right.size ||
        left.contentSha256 !== right.contentSha256 ||
        left.executable !== right.executable)
    ) {
      return false;
    }
  }
  return true;
}

export async function collectSourceSnapshot(
  rootDir: string,
  options: { includeBytes: boolean }
): Promise<PreparedTree> {
  const rootInfo = await lstatOrThrow(rootDir);
  assertRealDirectory(rootInfo, rootDir);

  const entries: EntrySnapshot[] = [];
  const treeFiles: PreparedTree["treeFiles"] = [];
  let fileCount = 0;
  let totalBytes = 0;

  async function walk(absoluteDir: string, depth: number): Promise<void> {
    if (depth > PROJECT_SKILLS_IMPORT_LIMITS.maxDepth) {
      throw new ProjectSkillsImportError(
        "depth-exceeded",
        `directory depth exceeds ${PROJECT_SKILLS_IMPORT_LIMITS.maxDepth}`
      );
    }

    let dirents: Dirent[];
    try {
      dirents = await readdir(absoluteDir, { withFileTypes: true });
    } catch (error) {
      throw new ProjectSkillsImportError(
        "not-directory",
        `failed to read directory: ${absoluteDir}`,
        { cause: error }
      );
    }

    const childNames = dirents.map((d) => d.name).sort();
    if (absoluteDir === rootDir) {
      // Root itself is not an entry; still record child set via files/dirs.
    } else {
      const relDir = toPosixRelative(rootDir, absoluteDir);
      assertSafeRelativePath(relDir);
      const info = await lstat(absoluteDir);
      assertRealDirectory(info, absoluteDir);
      entries.push({
        kind: "dir",
        relativePath: relDir,
        dev: toNumber(info.dev),
        ino: toNumber(info.ino),
        mode: toNumber(info.mode),
        mtimeNs: timeNs(info, "mtimeMs"),
        ctimeNs: timeNs(info, "ctimeMs"),
        childNames,
      });
    }

    for (const name of childNames) {
      const absolutePath = join(absoluteDir, name);
      const info = await lstat(absolutePath);

      if (
        info.isSymbolicLink() ||
        dirents.find((d) => d.name === name)?.isSymbolicLink()
      ) {
        const rel = toPosixRelative(rootDir, absolutePath);
        throw new ProjectSkillsImportError(
          "symlink",
          `symlink not allowed in skill tree: ${rel}`
        );
      }

      if (
        info.isFIFO() ||
        info.isSocket() ||
        info.isBlockDevice() ||
        info.isCharacterDevice()
      ) {
        const rel = toPosixRelative(rootDir, absolutePath);
        throw new ProjectSkillsImportError(
          "special-file",
          `special file not allowed: ${rel}`
        );
      }

      if (info.isDirectory()) {
        await walk(absolutePath, depth + 1);
        continue;
      }

      if (!info.isFile()) {
        const rel = toPosixRelative(rootDir, absolutePath);
        throw new ProjectSkillsImportError(
          "special-file",
          `unsupported file type: ${rel}`
        );
      }

      const relativePath = toPosixRelative(rootDir, absolutePath);
      assertSafeRelativePath(relativePath);

      const { bytes, lstatInfo } = await readFileNoFollow(absolutePath);
      // Re-check identity after read against the initial lstat.
      if (
        toNumber(lstatInfo.dev) !== toNumber(info.dev) ||
        toNumber(lstatInfo.ino) !== toNumber(info.ino) ||
        toNumber(lstatInfo.size) !== toNumber(info.size)
      ) {
        throw new ProjectSkillsImportError(
          "source-changed",
          `file changed during read: ${relativePath}`
        );
      }

      if (bytes.length > PROJECT_SKILLS_IMPORT_LIMITS.maxFileBytes) {
        throw new ProjectSkillsImportError(
          "file-too-large",
          `file exceeds ${PROJECT_SKILLS_IMPORT_LIMITS.maxFileBytes} bytes: ${relativePath}`
        );
      }

      fileCount += 1;
      if (fileCount > PROJECT_SKILLS_IMPORT_LIMITS.maxFiles) {
        throw new ProjectSkillsImportError(
          "too-many-files",
          `tree exceeds ${PROJECT_SKILLS_IMPORT_LIMITS.maxFiles} files`
        );
      }

      totalBytes += bytes.length;
      if (totalBytes > PROJECT_SKILLS_IMPORT_LIMITS.maxTotalBytes) {
        throw new ProjectSkillsImportError(
          "total-too-large",
          `tree exceeds ${PROJECT_SKILLS_IMPORT_LIMITS.maxTotalBytes} total bytes`
        );
      }

      // biome-ignore lint/suspicious/noBitwiseOperators: POSIX mode mask
      const executable = (toNumber(info.mode) & 0o111) !== 0;
      const contentSha256 = sha256Hex(bytes);
      entries.push({
        kind: "file",
        relativePath,
        dev: toNumber(info.dev),
        ino: toNumber(info.ino),
        mode: toNumber(info.mode),
        size: bytes.length,
        mtimeNs: timeNs(info, "mtimeMs"),
        ctimeNs: timeNs(info, "ctimeMs"),
        contentSha256,
        executable,
        bytes: options.includeBytes ? bytes : Buffer.alloc(0),
      });
      treeFiles.push({
        relativePath,
        executable,
        bytes: options.includeBytes ? bytes : Buffer.alloc(0),
      });
    }
  }

  await walk(rootDir, 0);
  entries.sort((a, b) => comparePaths(a.relativePath, b.relativePath));
  return { entries, fileCount, totalBytes, treeFiles };
}

export async function collectSourceSnapshotMeta(
  rootDir: string
): Promise<EntrySnapshot[]> {
  // Second traversal: metadata + content hashes, no retained bytes.
  const rootInfo = await lstatOrThrow(rootDir);
  assertRealDirectory(rootInfo, rootDir);
  const entries: EntrySnapshot[] = [];

  async function walk(absoluteDir: string, depth: number): Promise<void> {
    if (depth > PROJECT_SKILLS_IMPORT_LIMITS.maxDepth) {
      throw new ProjectSkillsImportError(
        "depth-exceeded",
        `directory depth exceeds ${PROJECT_SKILLS_IMPORT_LIMITS.maxDepth}`
      );
    }
    const dirents = await readdir(absoluteDir, { withFileTypes: true });
    const childNames = dirents.map((d) => d.name).sort();

    if (absoluteDir !== rootDir) {
      const relDir = toPosixRelative(rootDir, absoluteDir);
      const info = await lstat(absoluteDir);
      assertRealDirectory(info, absoluteDir);
      entries.push({
        kind: "dir",
        relativePath: relDir,
        dev: toNumber(info.dev),
        ino: toNumber(info.ino),
        mode: toNumber(info.mode),
        mtimeNs: timeNs(info, "mtimeMs"),
        ctimeNs: timeNs(info, "ctimeMs"),
        childNames,
      });
    }

    for (const name of childNames) {
      const absolutePath = join(absoluteDir, name);
      const info = await lstat(absolutePath);
      if (info.isSymbolicLink()) {
        throw new ProjectSkillsImportError(
          "symlink",
          `symlink not allowed: ${toPosixRelative(rootDir, absolutePath)}`
        );
      }
      if (info.isDirectory()) {
        await walk(absolutePath, depth + 1);
        continue;
      }
      if (!info.isFile()) {
        throw new ProjectSkillsImportError(
          "special-file",
          `special file not allowed: ${toPosixRelative(rootDir, absolutePath)}`
        );
      }
      if (info.nlink > 1) {
        throw new ProjectSkillsImportError(
          "hardlink",
          `hardlink not allowed: ${toPosixRelative(rootDir, absolutePath)}`
        );
      }
      const relativePath = toPosixRelative(rootDir, absolutePath);
      const { bytes } = await readFileNoFollow(absolutePath);
      entries.push({
        kind: "file",
        relativePath,
        dev: toNumber(info.dev),
        ino: toNumber(info.ino),
        mode: toNumber(info.mode),
        size: bytes.length,
        mtimeNs: timeNs(info, "mtimeMs"),
        ctimeNs: timeNs(info, "ctimeMs"),
        contentSha256: sha256Hex(bytes),
        // biome-ignore lint/suspicious/noBitwiseOperators: POSIX mode mask
        executable: (toNumber(info.mode) & 0o111) !== 0,
        bytes: Buffer.alloc(0),
      });
    }
  }

  await walk(rootDir, 0);
  entries.sort((a, b) => comparePaths(a.relativePath, b.relativePath));
  return entries;
}

export async function materializeStagingTree(
  stagingTreePath: string,
  prepared: PreparedTree
): Promise<void> {
  await mkdir(stagingTreePath, { recursive: true, mode: 0o755 });

  for (const entry of prepared.entries) {
    if (entry.kind === "dir") {
      await mkdir(join(stagingTreePath, entry.relativePath), {
        recursive: true,
        mode: 0o755,
      });
      continue;
    }
    const targetPath = join(stagingTreePath, entry.relativePath);
    await mkdir(dirname(targetPath), { recursive: true, mode: 0o755 });
    const mode = entry.executable ? 0o755 : 0o644;
    await writeFile(targetPath, entry.bytes, { mode });
  }
}
