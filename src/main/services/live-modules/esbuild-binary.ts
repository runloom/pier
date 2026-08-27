import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import type * as Esbuild from "esbuild";
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

/** Packaged Pier's unpacked esbuild — must not leak into `pnpm dev`. */
export function isPierPackagedEsbuildBinaryPath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  return (
    normalized.includes(
      "/Contents/Resources/app.asar.unpacked/node_modules/@esbuild/"
    ) && /\/bin\/esbuild(?:\.exe)?$/u.test(normalized)
  );
}

/**
 * Dev processes that inherit a packaged Pier's `ESBUILD_BINARY_PATH` spawn the
 * wrong binary. esbuild then exits on the version ping and every later compile
 * fails with "The service is no longer running".
 */
export function shouldClearInheritedEsbuildBinaryPath(input: {
  currentEnvPath?: string | undefined;
  resolvedPlatformBinary: string;
}): boolean {
  if (!input.currentEnvPath) {
    return false;
  }
  if (isAsarPackagedPath(input.resolvedPlatformBinary)) {
    return false;
  }
  return isPierPackagedEsbuildBinaryPath(input.currentEnvPath);
}

const ESBUILD_SERVICE_CLOSED_RE =
  /The service is no longer running|The service was stopped/u;

export function isEsbuildServiceClosedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return ESBUILD_SERVICE_CLOSED_RE.test(message);
}

/** User-facing diagnostic — do not leak esbuild's "service" wording. */
export const ESBUILD_SERVICE_CLOSED_USER_MESSAGE =
  "The canvas compiler stopped. Reload to try again.";

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

export function withTemporaryEsbuildBinaryPath<T>(input: {
  readonly binaryPath: string | null;
  readonly env?: NodeJS.ProcessEnv;
  readonly load: () => T;
}): T {
  const env = input.env ?? process.env;
  if (input.binaryPath === null) {
    return input.load();
  }
  const previous = env.ESBUILD_BINARY_PATH;
  env.ESBUILD_BINARY_PATH = input.binaryPath;
  try {
    return input.load();
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(env, "ESBUILD_BINARY_PATH");
    } else {
      env.ESBUILD_BINARY_PATH = previous;
    }
  }
}

/**
 * Load esbuild with the unpacked packaged binary without leaking the internal
 * override into terminals or any other child process.
 *
 * esbuild caches `process.env.ESBUILD_BINARY_PATH` the first time its CommonJS
 * entry loads. The require must stay synchronous so no concurrent child process
 * can inherit the packaged-only override.
 *
 * No-op in dev: esbuild resolves its own binary from node_modules, and the
 * platform package is not reachable from the host module graph under pnpm.
 */
let loadedEsbuildModule: typeof Esbuild | null = null;

export function loadEsbuildModule(): typeof Esbuild {
  if (loadedEsbuildModule) {
    return loadedEsbuildModule;
  }
  const moduleRequire = createRequire(import.meta.url);
  let binaryPath: string | null = null;
  try {
    const resolvedPlatformBinary = moduleRequire.resolve(
      `@esbuild/${process.platform}-${process.arch}/bin/esbuild`
    );
    if (
      shouldClearInheritedEsbuildBinaryPath({
        currentEnvPath: process.env.ESBUILD_BINARY_PATH,
        resolvedPlatformBinary,
      })
    ) {
      Reflect.deleteProperty(process.env, "ESBUILD_BINARY_PATH");
    }
    binaryPath = resolveEsbuildBinaryPath({
      currentEnvPath: process.env.ESBUILD_BINARY_PATH,
      resolvedPlatformBinary,
      unpackedExists: existsSync(
        unpackedEsbuildBinaryPath(resolvedPlatformBinary)
      ),
    });
  } catch {
    // Dev layout: let esbuild resolve its own binary from node_modules.
    if (
      shouldClearInheritedEsbuildBinaryPath({
        currentEnvPath: process.env.ESBUILD_BINARY_PATH,
        resolvedPlatformBinary: "",
      })
    ) {
      Reflect.deleteProperty(process.env, "ESBUILD_BINARY_PATH");
    }
  }
  loadedEsbuildModule = withTemporaryEsbuildBinaryPath({
    binaryPath,
    load: () => moduleRequire("esbuild") as typeof Esbuild,
  });
  return loadedEsbuildModule;
}

/** Stop the cached esbuild service worker if it was loaded. */
export async function stopEsbuildModule(): Promise<void> {
  const loaded = loadedEsbuildModule;
  loadedEsbuildModule = null;
  try {
    await loaded?.stop?.();
  } catch {
    // Best-effort shutdown on app quit / service dispose.
  }
}
