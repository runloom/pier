import { existsSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * esbuild spawns a native helper binary instead of running in-process.
 *
 * Packaged builds resolve that binary to a path inside `app.asar`, which is a
 * single file on disk — `spawn` fails with ENOTDIR and every canvas compile
 * reports "spawn ENOTDIR". electron-builder already unpacks the binary
 * (`app.asar.unpacked`), so only the path esbuild uses needs rewriting.
 *
 * Same asar → asar.unpacked rewrite as `ghosttyResourcesDirFromAddonPath`.
 */
export function unpackedEsbuildBinaryPath(resolvedPath: string): string {
  return resolvedPath.replace("/app.asar/", "/app.asar.unpacked/");
}

export function isAsarPackagedPath(resolvedPath: string): boolean {
  return resolvedPath.includes("/app.asar/");
}

/**
 * Pure resolution: returns the unpacked binary path to set, or null when the
 * caller should leave esbuild's own resolution alone (dev layout, non-asar
 * path, missing unpacked copy, or caller already configured the env).
 *
 * Extracted so the decision is unit-testable without process.env / module-state
 * side effects.
 */
export function resolveEsbuildBinaryPath(input: {
  /** Existing ESBUILD_BINARY_PATH, if already set by the environment. */
  currentEnvPath?: string | undefined;
  /** Resolved path of the platform binary (`@esbuild/<plat>/bin/esbuild`). */
  resolvedPlatformBinary: string;
  /** Whether the unpacked sibling exists on disk. */
  unpackedExists: boolean;
}): string | null {
  if (input.currentEnvPath) {
    return null;
  }
  if (!isAsarPackagedPath(input.resolvedPlatformBinary)) {
    return null;
  }
  const unpacked = unpackedEsbuildBinaryPath(input.resolvedPlatformBinary);
  return input.unpackedExists ? unpacked : null;
}

let ensured = false;

/**
 * Point esbuild at the unpacked binary before its first compile.
 *
 * esbuild caches `process.env.ESBUILD_BINARY_PATH` into a module-level variable
 * the first time its module loads (node_modules/esbuild/lib/main.js), so this
 * MUST run before `esbuild` is imported. `compile.ts` loads esbuild lazily via
 * `await import("esbuild")` after calling this.
 *
 * No-op in dev: esbuild resolves its own binary from node_modules, and the
 * platform package is not reachable from the host module graph under pnpm.
 */
export function ensureEsbuildBinaryPath(): void {
  if (ensured) {
    return;
  }
  ensured = true;
  try {
    const resolvedPlatformBinary = createRequire(import.meta.url).resolve(
      `@esbuild/${process.platform}-${process.arch}/bin/esbuild`
    );
    const unpacked = resolveEsbuildBinaryPath({
      currentEnvPath: process.env.ESBUILD_BINARY_PATH,
      resolvedPlatformBinary,
      unpackedExists: existsSync(
        unpackedEsbuildBinaryPath(resolvedPlatformBinary)
      ),
    });
    if (unpacked) {
      process.env.ESBUILD_BINARY_PATH = unpacked;
    }
  } catch {
    // Dev layout: leave esbuild's own resolution alone.
  }
}
