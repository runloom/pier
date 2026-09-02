import type * as esbuild from "esbuild";
import type { CompiledLiveAsset } from "./assets.ts";
import { loadEsbuildModule, stopEsbuildModule } from "./esbuild-binary.ts";
import {
  type CanvasTailwindCacheSlot,
  createCanvasTailwindCacheSlot,
} from "./tailwind.ts";

/**
 * Per-module esbuild context cache for incremental rebuilds + timeout cancel.
 *
 * Keyed by contentRoot/entry/framework plus the compile-option signature so a
 * spec.resolve change (allowNodeModules / allowedBarePackages / tsconfigPaths / forcePreviewBarrel /
 * previewBarrel) creates a fresh context instead of silently reusing one whose
 * plugin closures captured the old options.
 *
 * The cached entry owns the refs the plugin closures capture — callers
 * reset `entry.graphRef.current` / `entry.assetsRef.current` before each
 * rebuild, so graphs and asset lists stay fresh without rebinding closures.
 */
export interface CompileContextRefs {
  /** Captured by the asset plugin; reset by the caller before rebuild. */
  assetsRef: { current: CompiledLiveAsset[] };
  /** Captured by the resolve plugin; reset by the caller before rebuild. */
  graphRef: { current: Set<string> };
}

export interface CompileContextEntry extends CompileContextRefs {
  context: esbuild.BuildContext;
  /** Tailwind JIT cache — lives and dies with this esbuild context. */
  tailwindCache: CanvasTailwindCacheSlot;
}

const contextCache = new Map<string, CompileContextEntry>();

/** Full signature used to key the cache (options included). */
export function esbuildContextKey(input: {
  allowNodeModules: boolean;
  allowedBarePackages: readonly string[];
  contentRoot: string;
  entryAbsolutePath: string;
  extraFenceRoots?: readonly string[] | undefined;
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
    `abp:${[...input.allowedBarePackages].sort().join(",")}`,
    input.tsconfigPaths ? "tp1" : "tp0",
    input.forcePreviewBarrel ? "fb1" : "fb0",
    input.previewBarrelAbsolutePath ?? "",
    input.projectRoot ?? "",
    `efr:${[...(input.extraFenceRoots ?? [])].sort().join(",")}`,
  ].join("::");
}

/**
 * Get (or create) the cached context for `key`. `createOptions` receives the
 * entry's refs so plugin closures capture the same objects that later rebuilds
 * reset.
 */
export async function getCompileContextEntry(
  key: string,
  createOptions: (refs: CompileContextRefs) => esbuild.BuildOptions
): Promise<CompileContextEntry> {
  const cached = contextCache.get(key);
  if (cached) {
    return cached;
  }
  const graphRef: { current: Set<string> } = { current: new Set<string>() };
  const assetsRef: { current: CompiledLiveAsset[] } = { current: [] };
  const esbuild = loadEsbuildModule();
  const context = await esbuild.context(createOptions({ assetsRef, graphRef }));
  const entry: CompileContextEntry = {
    assetsRef,
    context,
    graphRef,
    tailwindCache: createCanvasTailwindCacheSlot(),
  };
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

/**
 * Drop dead contexts and call `esbuild.stop()` so the next `context()` spawns
 * a new helper. Needed when the child exits without going through `stop()` —
 * esbuild keeps the closed channel and every compile then fails with
 * "The service is no longer running".
 */
export async function recoverEsbuildService(): Promise<void> {
  await disposeAllCompileContexts();
  await stopEsbuildModule();
}
