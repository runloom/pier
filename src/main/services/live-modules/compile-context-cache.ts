import type * as esbuild from "esbuild";
import { loadEsbuildModule } from "./esbuild-binary.ts";

/**
 * Per-module esbuild context cache for incremental rebuilds + timeout cancel.
 *
 * Keyed by contentRoot/entry/framework plus the compile-option signature so a
 * spec.resolve change (allowNodeModules / tsconfigPaths / forcePreviewBarrel /
 * previewBarrel) creates a fresh context instead of silently reusing one whose
 * plugin closures captured the old options.
 *
 * The cached entry owns the `graphRef` the plugin closures capture — callers
 * reset `entry.graphRef.current` before each rebuild, so the dependency graph
 * is fresh without rebinding the closures.
 */
export interface CompileContextEntry {
  context: esbuild.BuildContext;
  /** Captured by the plugin closures; reset by the caller before rebuild. */
  graphRef: { current: Set<string> };
}

const contextCache = new Map<string, CompileContextEntry>();

/** Full signature used to key the cache (options included). */
export function esbuildContextKey(input: {
  allowNodeModules: boolean;
  contentRoot: string;
  entryAbsolutePath: string;
  forcePreviewBarrel: boolean;
  framework: string;
  previewBarrelAbsolutePath?: string | undefined;
  projectRoot: string | null;
  /** Root id prefix — lets service.ts dispose contexts per registered root. */
  rootId: string;
  tsconfigPaths: boolean;
}): string {
  return [
    input.rootId,
    input.contentRoot,
    input.entryAbsolutePath,
    input.framework,
    input.allowNodeModules ? "nm1" : "nm0",
    input.tsconfigPaths ? "tp1" : "tp0",
    input.forcePreviewBarrel ? "fb1" : "fb0",
    input.previewBarrelAbsolutePath ?? "",
    input.projectRoot ?? "",
  ].join("::");
}

/**
 * Get (or create) the cached context for `key`. `createOptions` receives the
 * entry's `graphRef` so plugin closures capture the same object that later
 * rebuilds reset.
 */
export async function getCompileContextEntry(
  key: string,
  createOptions: (graphRef: { current: Set<string> }) => esbuild.BuildOptions
): Promise<CompileContextEntry> {
  const cached = contextCache.get(key);
  if (cached) {
    return cached;
  }
  const graphRef: { current: Set<string> } = { current: new Set<string>() };
  const esbuild = loadEsbuildModule();
  const context = await esbuild.context(createOptions(graphRef));
  const entry: CompileContextEntry = { context, graphRef };
  contextCache.set(key, entry);
  return entry;
}

/** Cancel an in-flight rebuild for this key (best-effort, ignores errors). */
export async function cancelCompileContext(key: string): Promise<void> {
  const cached = contextCache.get(key);
  if (!cached) {
    return;
  }
  try {
    await cached.context.cancel();
  } catch {
    // Context may already be disposed or no rebuild in flight.
  }
}

/**
 * Dispose `key` only while it still maps to `entry`. Failure-path cleanup
 * runs after awaits (timeout / user retry may already have replaced the
 * cache slot) and must not tear down a successor compile's context.
 */
export async function disposeCompileContextIfCurrent(
  key: string,
  entry: CompileContextEntry
): Promise<void> {
  if (contextCache.get(key) !== entry) {
    return;
  }
  contextCache.delete(key);
  try {
    await entry.context.dispose();
  } catch {
    // Best-effort cleanup.
  }
}

/** Dispose every context whose key starts with the given root id. */
export async function disposeCompileContextsForRoot(
  rootId: string
): Promise<void> {
  const prefix = `${rootId}::`;
  const entries = [...contextCache.entries()].filter(([key]) =>
    key.startsWith(prefix)
  );
  for (const [key, entry] of entries) {
    contextCache.delete(key);
    try {
      await entry.context.dispose();
    } catch {
      // Best-effort.
    }
  }
}

/** Dispose all cached contexts (service.dispose / app quit). */
export async function disposeAllCompileContexts(): Promise<void> {
  const entries = [...contextCache.entries()];
  contextCache.clear();
  await Promise.all(
    entries.map(async ([, entry]) => {
      try {
        await entry.context.dispose();
      } catch {
        // Best-effort.
      }
    })
  );
}
