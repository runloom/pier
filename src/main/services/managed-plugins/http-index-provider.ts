import type { OfficialPluginIndex } from "@shared/contracts/managed-plugin.ts";
import {
  fetchOfficialPluginIndex,
  type OfficialIndexDiagnostic,
  type OfficialIndexSource,
} from "./official-index.ts";

export type { OfficialIndexDiagnostic } from "./official-index.ts";
export { DEFAULT_OFFICIAL_PLUGIN_INDEX_URL } from "./official-index.ts";

/**
 * Runtime orchestration around `fetchOfficialPluginIndex`.
 *
 * Contract:
 *   - `snapshot()` returns the latest known-good index (from cache or a prior
 *     network fetch) synchronously. Never blocks — install flow only fetches
 *     a fresh version on-demand via `refresh()`.
 *   - `refresh()` runs a full fetch → verify → cache write cycle. Returns
 *     diagnostics + source ("network" | "cache" | "empty").
 *   - `whenReady()` resolves after the first refresh completes (used by the
 *     app-core boot chain to gate broadcasts).
 *
 * Failure modes are diagnostics, never throws. Callers that depend on a
 * strict version (install) must handle `snapshot() === null` explicitly.
 */

export interface HttpOfficialIndexProviderOptions {
  readonly cachePath: string;
  readonly env?: Record<string, string | undefined>;
  readonly indexUrl?: string;
  readonly logger?: (diagnostics: readonly OfficialIndexDiagnostic[]) => void;
  readonly now?: () => number;
  readonly runtimeMode: "development" | "production" | "test";
}

export interface HttpOfficialIndexProvider {
  readonly refresh: () => Promise<{
    diagnostics: readonly OfficialIndexDiagnostic[];
    index: OfficialPluginIndex | null;
    source: OfficialIndexSource;
  }>;
  readonly snapshot: () => OfficialPluginIndex | null;
  readonly whenReady: () => Promise<void>;
}

export function createHttpOfficialIndexProvider(
  options: HttpOfficialIndexProviderOptions
): HttpOfficialIndexProvider {
  let cached: OfficialPluginIndex | null = null;
  const ready = Promise.withResolvers<void>();
  let readyFired = false;

  async function refresh(): Promise<{
    diagnostics: readonly OfficialIndexDiagnostic[];
    index: OfficialPluginIndex | null;
    source: OfficialIndexSource;
  }> {
    const result = await fetchOfficialPluginIndex({
      cachePath: options.cachePath,
      env: options.env ?? process.env,
      runtimeMode: options.runtimeMode,
      ...(options.now ? { now: options.now } : {}),
    });
    if (result.index) {
      cached = result.index;
    }
    if (result.diagnostics.length > 0 && options.logger) {
      options.logger(result.diagnostics);
    }
    if (!readyFired) {
      readyFired = true;
      ready.resolve();
    }
    return result;
  }

  return {
    snapshot: () => cached,
    refresh,
    whenReady: () => ready.promise,
  };
}
