import { createHash } from "node:crypto";
import { constants, type Dirent, type Stats } from "node:fs";
import { lstat, open, readdir, readlink } from "node:fs/promises";
import {
  isAbsolute,
  join,
  normalize,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  type ImportCallerBinding,
  PROJECT_SKILLS_DISCOVERY_ROOTS,
  PROJECT_SKILLS_IMPORT_LIMITS,
  ProjectSkillsImportError,
} from "./import-limits.ts";

const OPEN_NOFOLLOW =
  typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;

export function isErrno(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

export function toNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

export function timeNs(info: Stats, field: "mtimeMs" | "ctimeMs"): bigint {
  return BigInt(Math.round(info[field] * 1e6));
}

export function defaultCallerBinding(): ImportCallerBinding {
  return { webContentsId: 0, clientInstanceId: "local" };
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function toPosixRelative(rootDir: string, absolutePath: string): string {
  const rel = relative(rootDir, absolutePath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new ProjectSkillsImportError(
      "path-escape",
      `path escapes tree root: ${absolutePath}`
    );
  }
  if (rel === "") {
    throw new ProjectSkillsImportError(
      "path-escape",
      "empty relative path is not allowed"
    );
  }
  return rel.split(sep).join(posix.sep);
}

export function assertSafeRelativePath(relativePath: string): void {
  if (relativePath.length === 0) {
    throw new ProjectSkillsImportError("path-escape", "empty path segment");
  }
  if (relativePath.includes("\0")) {
    throw new ProjectSkillsImportError(
      "path-escape",
      "path must not contain NUL"
    );
  }
  for (const ch of relativePath) {
    const code = ch.charCodeAt(0);
    if (code < 0x20) {
      throw new ProjectSkillsImportError(
        "path-escape",
        "path must not contain control characters"
      );
    }
  }
  const segments = relativePath.split(posix.sep);
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new ProjectSkillsImportError(
        "path-escape",
        `invalid path segment in ${relativePath}`
      );
    }
  }
  const pathBytes = Buffer.byteLength(relativePath, "utf8");
  if (pathBytes > PROJECT_SKILLS_IMPORT_LIMITS.maxPathBytes) {
    throw new ProjectSkillsImportError(
      "path-too-long",
      `relative path exceeds ${PROJECT_SKILLS_IMPORT_LIMITS.maxPathBytes} bytes: ${relativePath}`
    );
  }
}

export function comparePaths(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

export function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || !(rel.startsWith("..") || isAbsolute(rel));
}

export function sameFsIdentity(left: Stats, right: Stats): boolean {
  return (
    toNumber(left.dev) === toNumber(right.dev) &&
    toNumber(left.ino) === toNumber(right.ino)
  );
}

export async function lstatOrThrow(path: string): Promise<Stats> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      throw new ProjectSkillsImportError(
        "not-directory",
        `path does not exist: ${path}`,
        { cause: error }
      );
    }
    throw error;
  }
}

export function assertRealDirectory(info: Stats, path: string): void {
  if (info.isSymbolicLink()) {
    throw new ProjectSkillsImportError(
      "symlink",
      `path must not be a symbolic link: ${path}`
    );
  }
  if (!info.isDirectory()) {
    throw new ProjectSkillsImportError(
      "not-directory",
      `path must be a real directory: ${path}`
    );
  }
}

export async function readFileNoFollow(absolutePath: string): Promise<{
  bytes: Buffer;
  lstatInfo: Stats;
  fstatInfo: Stats;
}> {
  const lstatInfo = await lstat(absolutePath);
  if (lstatInfo.isSymbolicLink()) {
    throw new ProjectSkillsImportError(
      "symlink",
      `symlink not allowed: ${absolutePath}`
    );
  }
  if (
    lstatInfo.isFIFO() ||
    lstatInfo.isSocket() ||
    lstatInfo.isBlockDevice() ||
    lstatInfo.isCharacterDevice()
  ) {
    throw new ProjectSkillsImportError(
      "special-file",
      `special file not allowed: ${absolutePath}`
    );
  }
  if (!lstatInfo.isFile()) {
    throw new ProjectSkillsImportError(
      "special-file",
      `unsupported file type: ${absolutePath}`
    );
  }
  if (lstatInfo.nlink > 1) {
    throw new ProjectSkillsImportError(
      "hardlink",
      `hardlink not allowed: ${absolutePath}`
    );
  }

  // biome-ignore lint/suspicious/noBitwiseOperators: fs open flags
  const handle = await open(absolutePath, constants.O_RDONLY | OPEN_NOFOLLOW);
  try {
    const fstatInfo = await handle.stat();
    if (
      toNumber(fstatInfo.dev) !== toNumber(lstatInfo.dev) ||
      toNumber(fstatInfo.ino) !== toNumber(lstatInfo.ino) ||
      !fstatInfo.isFile()
    ) {
      throw new ProjectSkillsImportError(
        "source-changed",
        `file identity changed during open: ${absolutePath}`
      );
    }
    if (fstatInfo.nlink > 1) {
      throw new ProjectSkillsImportError(
        "hardlink",
        `hardlink not allowed: ${absolutePath}`
      );
    }
    const bytes = Buffer.from(await handle.readFile());
    return { bytes, lstatInfo, fstatInfo };
  } finally {
    await handle.close();
  }
}

export function normalizeRelativeSource(relativeSource: string): string {
  if (isAbsolute(relativeSource)) {
    throw new ProjectSkillsImportError(
      "invalid-relative-source",
      "relativeSource must be project-relative"
    );
  }
  const normalized = normalize(relativeSource).split(sep).join(posix.sep);
  if (
    normalized === "" ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    normalized.includes("\0")
  ) {
    throw new ProjectSkillsImportError(
      "invalid-relative-source",
      `invalid relativeSource: ${relativeSource}`
    );
  }
  const segments = normalized.split(posix.sep);
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    throw new ProjectSkillsImportError(
      "invalid-relative-source",
      `invalid relativeSource: ${relativeSource}`
    );
  }
  return normalized;
}

export function isUnderDiscoveryRoot(relativeSource: string): boolean {
  return PROJECT_SKILLS_DISCOVERY_ROOTS.some(
    (root) => relativeSource === root || relativeSource.startsWith(`${root}/`)
  );
}

export async function isManagedProjection(
  absolutePath: string
): Promise<boolean> {
  const info = await lstat(absolutePath);
  if (!info.isSymbolicLink()) return false;
  try {
    const target = await readlink(absolutePath);
    // Managed projections are relative links into .pier/skills/library/<id>
    if (isAbsolute(target)) return false;
    const normalized = target.split(sep).join(posix.sep);
    return (
      normalized.includes(".pier/skills/library/") ||
      /(^|\/)\.pier\/skills\/library\//.test(normalized)
    );
  } catch {
    return true;
  }
}

export async function directoryTotalBytes(dir: string): Promise<number> {
  let total = 0;
  async function walk(current: string): Promise<void> {
    let dirents: Dirent[];
    try {
      dirents = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (isErrno(error, "ENOENT")) return;
      throw error;
    }
    for (const dirent of dirents) {
      const p = join(current, dirent.name);
      if (dirent.isDirectory()) {
        await walk(p);
        continue;
      }
      if (dirent.isFile()) {
        const info = await lstat(p);
        total += toNumber(info.size);
      }
    }
  }
  await walk(dir);
  return total;
}
