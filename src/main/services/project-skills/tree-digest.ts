import { createHash, type Hash } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";

const TREE_DOMAIN = "tree-sha256-v1";
const RISK_DOMAIN = "risk-fingerprint-v1";

const RISK_FRONTMATTER_KEYS: Record<string, true> = {
  "allowed-tools": true,
  allowedTools: true,
  tools: true,
  "disable-model-invocation": true,
  disableModelInvocation: true,
  context: true,
  hooks: true,
  permissions: true,
};

/** Substrings that indicate dynamic / shell-eval command surface in skill files. */
const DYNAMIC_COMMAND_PATTERNS: readonly RegExp[] = [
  /\beval\b/i,
  /\$\(/,
  /`[^`]+`/,
  /\$\{/,
  /\bsource\b/i,
  /\bbash\s+-c\b/i,
  /\bsh\s+-c\b/i,
  /\bzsh\s+-c\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\/dev\/(tcp|udp)\//i,
  /\bchmod\s+\+x\b/i,
  /\bos\.system\b/i,
  /\bchild_process\b/i,
  /\bexec(?:File|Sync)?\s*\(/i,
];

export class TreeDigestError extends Error {
  readonly code:
    | "symlink"
    | "hardlink"
    | "special-file"
    | "case-fold-conflict"
    | "unicode-normalize-conflict"
    | "not-directory"
    | "invalid-path";

  constructor(
    code: TreeDigestError["code"],
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "TreeDigestError";
    this.code = code;
  }
}

type TreeEntry =
  | {
      kind: "dir";
      relativePath: string;
      pathBytes: Buffer;
    }
  | {
      kind: "file";
      relativePath: string;
      pathBytes: Buffer;
      bytes: Buffer;
      executable: boolean;
    };

function toPosixRelative(rootDir: string, absolutePath: string): string {
  const rel = relative(rootDir, absolutePath);
  if (rel.startsWith("..") || rel === "") {
    throw new TreeDigestError(
      "invalid-path",
      `path escapes tree root: ${absolutePath}`
    );
  }
  return rel.split(sep).join(posix.sep);
}

function writeU32BE(value: number): Buffer {
  const buf = Buffer.allocUnsafe(4);
  // biome-ignore lint/suspicious/noBitwiseOperators: canonical u32 clamp
  buf.writeUInt32BE(value >>> 0);
  return buf;
}

function writeU64BE(value: number | bigint): Buffer {
  const buf = Buffer.allocUnsafe(8);
  buf.writeBigUInt64BE(BigInt(value));
  return buf;
}

function updateLengthPrefixed(hash: Hash, part: Buffer | string): void {
  const bytes = typeof part === "string" ? Buffer.from(part, "utf8") : part;
  hash.update(writeU32BE(bytes.length));
  hash.update(bytes);
}

/**
 * Detect case-fold and Unicode NFC collisions among relative paths.
 * Exported for unit tests on volumes that cannot materialize both names.
 */
export function assertTreeRelativePathConflicts(
  relativePaths: readonly string[]
): void {
  const byCase = new Map<string, string>();
  const byNfc = new Map<string, string>();

  for (const original of relativePaths) {
    const folded = original.toLocaleLowerCase("en-US");
    const priorCase = byCase.get(folded);
    if (priorCase !== undefined && priorCase !== original) {
      throw new TreeDigestError(
        "case-fold-conflict",
        `case-fold path conflict: "${priorCase}" vs "${original}"`
      );
    }
    byCase.set(folded, original);

    const nfc = original.normalize("NFC");
    const priorNfc = byNfc.get(nfc);
    if (priorNfc !== undefined && priorNfc !== original) {
      throw new TreeDigestError(
        "unicode-normalize-conflict",
        `unicode normalization path conflict: "${priorNfc}" vs "${original}"`
      );
    }
    byNfc.set(nfc, original);
  }
}

function assertNoPathConflicts(entries: readonly TreeEntry[]): void {
  assertTreeRelativePathConflicts(entries.map((entry) => entry.relativePath));
}

async function collectTreeEntries(rootDir: string): Promise<TreeEntry[]> {
  const rootInfo = await lstat(rootDir);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new TreeDigestError(
      "not-directory",
      `tree root must be a real directory: ${rootDir}`
    );
  }

  const entries: TreeEntry[] = [];

  async function walk(absoluteDir: string): Promise<void> {
    let dirents: Dirent[];
    try {
      dirents = await readdir(absoluteDir, { withFileTypes: true });
    } catch (error) {
      throw new TreeDigestError(
        "invalid-path",
        `failed to read directory: ${absoluteDir}`,
        { cause: error }
      );
    }

    // Deterministic readdir order is not required; we sort before hashing.
    for (const dirent of dirents) {
      const absolutePath = join(absoluteDir, dirent.name);
      const info = await lstat(absolutePath);
      const relativePath = toPosixRelative(rootDir, absolutePath);
      const pathBytes = Buffer.from(relativePath, "utf8");

      if (info.isSymbolicLink() || dirent.isSymbolicLink()) {
        throw new TreeDigestError(
          "symlink",
          `symlink not allowed in skill tree: ${relativePath}`
        );
      }

      if (
        info.isFIFO() ||
        info.isSocket() ||
        info.isBlockDevice() ||
        info.isCharacterDevice()
      ) {
        throw new TreeDigestError(
          "special-file",
          `special file not allowed in skill tree: ${relativePath}`
        );
      }

      if (info.isDirectory()) {
        entries.push({ kind: "dir", relativePath, pathBytes });
        await walk(absolutePath);
        continue;
      }

      if (!info.isFile()) {
        throw new TreeDigestError(
          "special-file",
          `unsupported file type in skill tree: ${relativePath}`
        );
      }

      // Hardlink: more than one directory entry references this inode.
      if (info.nlink > 1) {
        throw new TreeDigestError(
          "hardlink",
          `hardlink not allowed in skill tree: ${relativePath}`
        );
      }

      const bytes = await readFile(absolutePath);
      entries.push({
        kind: "file",
        relativePath,
        pathBytes,
        bytes,
        // biome-ignore lint/suspicious/noBitwiseOperators: POSIX mode mask
        executable: (info.mode & 0o111) !== 0,
      });
    }
  }

  await walk(rootDir);
  return entries;
}

function comparePathBytes(left: Buffer, right: Buffer): number {
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    const d = left[i]! - right[i]!;
    if (d !== 0) {
      return d;
    }
  }
  return left.length - right.length;
}

/**
 * tree-sha256-v1: path-byte order, entry type, path, file length, content,
 * executable bit. Rejects symlink / hardlink / special / case-fold /
 * unicode-normalize conflicts. Does not include mtime.
 */
export async function computeTreeSha256V1(rootDir: string): Promise<string> {
  const entries = await collectTreeEntries(rootDir);
  assertNoPathConflicts(entries);
  entries.sort((a, b) => comparePathBytes(a.pathBytes, b.pathBytes));

  const hash = createHash("sha256");
  updateLengthPrefixed(hash, TREE_DOMAIN);

  for (const entry of entries) {
    updateLengthPrefixed(hash, entry.kind);
    updateLengthPrefixed(hash, entry.pathBytes);
    if (entry.kind === "file") {
      hash.update(writeU64BE(entry.bytes.length));
      // Content is length-known; still length-prefix for unambiguity vs path frames.
      updateLengthPrefixed(hash, entry.bytes);
      updateLengthPrefixed(hash, entry.executable ? "1" : "0");
    }
  }

  return `sha256:${hash.digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function extractRiskFrontmatter(
  frontmatter: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(frontmatter).sort()) {
    if (RISK_FRONTMATTER_KEYS[key]) {
      out[key] = frontmatter[key];
    }
  }
  return out;
}

export function collectDynamicCommandTraces(
  treeFiles: readonly {
    relativePath: string;
    executable: boolean;
    bytes?: Buffer;
  }[]
): string[] {
  const traces: string[] = [];
  for (const file of treeFiles) {
    if (!file.bytes) {
      continue;
    }
    // Binary-ish files: only scan as utf8 lossy text for patterns.
    const text = file.bytes.toString("utf8");
    for (const pattern of DYNAMIC_COMMAND_PATTERNS) {
      if (pattern.test(text)) {
        traces.push(`${file.relativePath}:${pattern.source}`);
      }
    }
  }
  traces.sort();
  return traces;
}

/**
 * Risk fingerprint over executable set, dynamic command traces, and
 * frontmatter risk fields (e.g. allowed-tools). Same contentDigest with a
 * different risk surface must yield a different fingerprint.
 */
export function computeRiskFingerprint(args: {
  treeFiles: readonly {
    relativePath: string;
    executable: boolean;
    bytes?: Buffer;
  }[];
  frontmatter: Record<string, unknown>;
}): string {
  const executables = args.treeFiles
    .filter((file) => file.executable)
    .map((file) => file.relativePath)
    .sort((a, b) => {
      if (a < b) return -1;
      return a > b ? 1 : 0;
    });

  const payload = {
    dynamicCommandTraces: collectDynamicCommandTraces(args.treeFiles),
    executables,
    riskFrontmatter: extractRiskFrontmatter(args.frontmatter),
  };

  const hash = createHash("sha256");
  updateLengthPrefixed(hash, RISK_DOMAIN);
  updateLengthPrefixed(hash, canonicalJson(payload));
  return `sha256:${hash.digest("hex")}`;
}
