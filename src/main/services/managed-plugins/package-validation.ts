import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, posix } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import {
  type ManagedPluginPackageManifest,
  managedPluginPackageManifestSchema,
} from "@shared/contracts/managed-plugin.ts";
import { parse as parseImports } from "es-module-lexer";
import * as tar from "tar-stream";
import { isPierRangeCompatible } from "./version.ts";

/**
 * Package validation for managed plugin `.tgz` archives and their extracted
 * directories. Two-pass extraction (validate members → extract), followed by
 * ESM marker + import specifier + eval-usage scanning (design §7.4).
 *
 * Every extraction / validation entry point applies MANAGED_PLUGIN_PACKAGE_LIMITS
 * unless the caller overrides — production install paths never pass unbounded
 * limits (Global Constraint 3 / plan Task 3).
 */

export const MANAGED_PLUGIN_PACKAGE_LIMITS = {
  maxDepth: 16,
  maxEntries: 2048,
  maxEntryBytes: 10 * 1024 * 1024,
  maxPathLength: 240,
  maxTotalUncompressedBytes: 50 * 1024 * 1024,
} as const;

export type ArchiveLimits = Partial<typeof MANAGED_PLUGIN_PACKAGE_LIMITS>;

interface ResolvedLimits {
  readonly maxDepth: number;
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxPathLength: number;
  readonly maxTotalUncompressedBytes: number;
}

function resolveLimits(options?: ArchiveLimits): ResolvedLimits {
  return {
    maxDepth: options?.maxDepth ?? MANAGED_PLUGIN_PACKAGE_LIMITS.maxDepth,
    maxEntries: options?.maxEntries ?? MANAGED_PLUGIN_PACKAGE_LIMITS.maxEntries,
    maxEntryBytes:
      options?.maxEntryBytes ?? MANAGED_PLUGIN_PACKAGE_LIMITS.maxEntryBytes,
    maxPathLength:
      options?.maxPathLength ?? MANAGED_PLUGIN_PACKAGE_LIMITS.maxPathLength,
    maxTotalUncompressedBytes:
      options?.maxTotalUncompressedBytes ??
      MANAGED_PLUGIN_PACKAGE_LIMITS.maxTotalUncompressedBytes,
  };
}

/**
 * POSIX-relative path safety. Rejects absolute paths, drive letters, UNC,
 * `..` segments, and empty segments.
 */
export function assertSafeArchiveMemberPath(memberPath: string): void {
  if (!memberPath || memberPath.length === 0) {
    throw new Error("unsafe archive member (empty path)");
  }
  const normalized = posix.normalize(memberPath);
  if (normalized.startsWith("/")) {
    throw new Error(`unsafe archive member (absolute): ${memberPath}`);
  }
  if (/^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`unsafe archive member (drive letter): ${memberPath}`);
  }
  if (normalized.startsWith("\\\\") || memberPath.startsWith("\\\\")) {
    throw new Error(`unsafe archive member (UNC): ${memberPath}`);
  }
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment === "..") {
      throw new Error(
        `unsafe archive member (parent traversal): ${memberPath}`
      );
    }
  }
  if (normalized === "." || normalized === "") {
    throw new Error(
      `unsafe archive member (empty after normalize): ${memberPath}`
    );
  }
}

interface TarHeader {
  linkname?: string;
  name: string;
  size?: number;
  type?: string;
}

async function readTarHeaders(
  archivePath: string
): Promise<readonly TarHeader[]> {
  const headers: TarHeader[] = [];
  const extract = tar.extract();
  extract.on("entry", (header, stream, next) => {
    headers.push({
      name: header.name,
      size: header.size ?? 0,
      ...(header.type ? { type: header.type } : {}),
      ...(header.linkname ? { linkname: header.linkname } : {}),
    });
    stream.on("end", next);
    stream.resume();
  });
  await pipeline(createReadStream(archivePath), createGunzip(), extract);
  return headers;
}

/**
 * Streams the archive once and validates every header before returning.
 * Never writes to disk. Callers use `extractTgzSafely` for actual writes.
 */
export async function validateTgzMembers(
  archivePath: string,
  options?: ArchiveLimits
): Promise<void> {
  const limits = resolveLimits(options);
  const headers = await readTarHeaders(archivePath);
  if (headers.length > limits.maxEntries) {
    throw new Error(
      `too many entries: ${headers.length} > ${limits.maxEntries}`
    );
  }
  let total = 0;
  const seen = new Set<string>();
  for (const header of headers) {
    const memberPath = header.name;
    assertSafeArchiveMemberPath(memberPath);
    if (memberPath.length > limits.maxPathLength) {
      throw new Error(
        `path too long (${memberPath.length}): ${memberPath.slice(0, 40)}...`
      );
    }
    const depth = memberPath.split("/").length - 1;
    if (depth > limits.maxDepth) {
      throw new Error(`path too deep (depth ${depth}): ${memberPath}`);
    }
    if (header.type === "symlink" || header.type === "link") {
      throw new Error(`links are not allowed: ${memberPath}`);
    }
    if (header.type && header.type !== "file" && header.type !== "directory") {
      throw new Error(
        `unsupported tar entry type ${header.type}: ${memberPath}`
      );
    }
    const canonical = posix.normalize(memberPath).toLowerCase();
    if (seen.has(canonical)) {
      throw new Error(`duplicate archive member: ${memberPath}`);
    }
    seen.add(canonical);
    const size = header.size ?? 0;
    if (size > limits.maxEntryBytes) {
      throw new Error(`entry too large (${size}): ${memberPath}`);
    }
    total += size;
    if (total > limits.maxTotalUncompressedBytes) {
      throw new Error(
        `archive too large (${total} > ${limits.maxTotalUncompressedBytes})`
      );
    }
  }
}

/**
 * Two-pass safe extraction: validate all members first, then extract with a
 * second stream. Every extracted path is verified to remain under
 * `realpath(stagingDir)` before writing.
 */
export async function extractTgzSafely(
  archivePath: string,
  stagingDir: string,
  options?: ArchiveLimits
): Promise<string> {
  await validateTgzMembers(archivePath, options);
  await mkdir(stagingDir, { recursive: true });
  const stagingRoot = await realpath(stagingDir);
  const extract = tar.extract();
  const writes: Promise<void>[] = [];
  extract.on("entry", (header, stream, next) => {
    if (header.type === "symlink" || header.type === "link") {
      stream.resume();
      next(new Error(`links are not allowed: ${header.name}`));
      return;
    }
    const memberPath = header.name;
    try {
      assertSafeArchiveMemberPath(memberPath);
    } catch (err) {
      stream.resume();
      next(err as Error);
      return;
    }
    const targetPath = join(stagingRoot, memberPath);
    if (
      !targetPath.startsWith(`${stagingRoot}/`) &&
      targetPath !== stagingRoot
    ) {
      stream.resume();
      next(new Error(`resolved path escapes staging: ${memberPath}`));
      return;
    }
    if (header.type === "directory") {
      writes.push(
        mkdir(targetPath, { mode: 0o755, recursive: true }).then(() => {
          /* no-op */
        })
      );
      stream.on("end", next);
      stream.resume();
      return;
    }
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => {
      const tmp = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
      writes.push(
        (async () => {
          await mkdir(join(targetPath, ".."), { recursive: true });
          await writeFile(tmp, Buffer.concat(chunks), { mode: 0o644 });
          await rename(tmp, targetPath);
        })()
      );
      next();
    });
  });
  await pipeline(createReadStream(archivePath), createGunzip(), extract);
  await Promise.all(writes);
  return stagingDir;
}

async function sha256File(
  path: string
): Promise<{ hash: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += buf.length;
      hash.update(buf);
    });
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return { hash: hash.digest("hex"), size };
}

const HOST_APPROVED_RENDERER_IMPORTS: Record<string, true> = {
  // @pier/plugin-api and its subpath shims are the only React/JSX bridge
  // renderer bundles may import at runtime. The build preset rewrites
  // `react` / `react/jsx-runtime` / `react-dom/*` bare specifiers to these
  // shims (design §7.4) — an emitted bundle still containing raw `react`
  // means the build preset was misconfigured.
  "@pier/plugin-api": true,
  "@pier/plugin-api/react": true,
  "@pier/plugin-api/jsx-runtime": true,
  "@pier/plugin-api/jsx-dev-runtime": true,
  "@pier/plugin-api/react-dom-client": true,
  "@pier/ui": true,
  "lucide-react": true,
};

const HOST_APPROVED_MAIN_IMPORTS: Record<string, true> = {
  "@pier/plugin-api": true,
};

const NODE_BUILTIN_RE = /^node:/;

function isRelativeSpecifier(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../") || spec === ".";
}

function scanImports(source: string): readonly string[] {
  const [imports] = parseImports(source);
  const specifiers: string[] = [];
  for (const entry of imports) {
    // es-module-lexer marks `import.meta` metaproperty with d === -2.
    // Dynamic imports use d >= 0 (offset of `(`). Static imports use d === -1.
    if (entry.d === -2) {
      continue;
    }
    const raw = source.slice(entry.s, entry.e);
    const literal = raw.replace(/^['"`]|['"`]$/g, "");
    if (literal.length > 0 && !literal.includes("${")) {
      specifiers.push(literal);
    }
  }
  return specifiers;
}

function assertNoEvalUsage(source: string, label: string): void {
  const stripped = source.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
  if (/\beval\s*\(/.test(stripped) || /\bnew\s+Function\s*\(/.test(stripped)) {
    throw new Error(`eval is not allowed in ${label}`);
  }
}

export interface ValidateManagedPluginPackageOptions {
  readonly archivePath: string | null;
  readonly expectedId: string;
  readonly expectedSha256: string | null;
  readonly expectedSize: number | null;
  readonly expectedVersion: string;
  readonly packageDir: string;
  readonly pierVersion: string;
}

export interface ValidatedManagedPluginPackage {
  readonly manifest: ManagedPluginPackageManifest;
}

export async function validateManagedPluginPackage(
  options: ValidateManagedPluginPackageOptions
): Promise<ValidatedManagedPluginPackage> {
  if (options.archivePath) {
    const stats = await stat(options.archivePath);
    if (options.expectedSize !== null && stats.size !== options.expectedSize) {
      throw new Error(
        `archive size mismatch: expected ${options.expectedSize}, got ${stats.size}`
      );
    }
    const { hash } = await sha256File(options.archivePath);
    if (options.expectedSha256 !== null && hash !== options.expectedSha256) {
      throw new Error(
        `archive sha256 mismatch: expected ${options.expectedSha256}, got ${hash}`
      );
    }
  }

  const pkgJsonRaw = await readFile(
    join(options.packageDir, "package.json"),
    "utf8"
  );
  const pkgJson = JSON.parse(pkgJsonRaw) as { type?: string };
  if (pkgJson.type !== "module") {
    throw new Error(
      `ESM package marker missing: package.json must declare "type": "module"`
    );
  }

  const manifestRaw = await readFile(
    join(options.packageDir, "plugin.json"),
    "utf8"
  );
  const manifest = managedPluginPackageManifestSchema.parse(
    JSON.parse(manifestRaw)
  );
  if (manifest.id !== options.expectedId) {
    throw new Error(
      `manifest id mismatch: expected ${options.expectedId}, got ${manifest.id}`
    );
  }
  if (manifest.version !== options.expectedVersion) {
    throw new Error(
      `manifest version mismatch: expected ${options.expectedVersion}, got ${manifest.version}`
    );
  }
  if (!isPierRangeCompatible(manifest.engines.pier, options.pierVersion)) {
    throw new Error(
      `incompatible Pier version: manifest requires ${manifest.engines.pier}, host is ${options.pierVersion}`
    );
  }

  const mainSource = await readFile(
    join(options.packageDir, manifest.main),
    "utf8"
  );
  const rendererSource = await readFile(
    join(options.packageDir, manifest.renderer),
    "utf8"
  );

  for (const spec of scanImports(mainSource)) {
    if (isRelativeSpecifier(spec) || NODE_BUILTIN_RE.test(spec)) {
      continue;
    }
    if (HOST_APPROVED_MAIN_IMPORTS[spec]) {
      continue;
    }
    throw new Error(
      `unresolved main import "${spec}" — main bundle must inline non-relative deps except node: builtins`
    );
  }
  assertNoEvalUsage(mainSource, "main bundle");

  for (const spec of scanImports(rendererSource)) {
    if (isRelativeSpecifier(spec)) {
      continue;
    }
    if (
      HOST_APPROVED_RENDERER_IMPORTS[spec] ||
      spec.startsWith("@pier/plugin-api/")
    ) {
      continue;
    }
    throw new Error(
      `unresolved renderer import "${spec}" — renderer bundle must alias React/JSX runtime through @pier/plugin-api shims`
    );
  }
  assertNoEvalUsage(rendererSource, "renderer bundle");

  return { manifest };
}
