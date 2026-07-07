import { join } from "node:path";

/**
 * Derives the fixed set of paths under `{userData}/plugins/` used by the
 * managed plugin install service (design §4.2).
 *
 * MUST be called after `configureAppIdentity()` has finalized Electron's
 * `userData` path (Global Constraint 31; startup ordering in Task 4).
 */
export interface ManagedPluginPaths {
  readonly indexFile: string;
  readonly installedDir: string;
  readonly officialIndexCacheFile: string;
  readonly operationLogFile: string;
  readonly pluginsDir: string;
  readonly stagingDir: string;
  readonly workDir: string;
}

export function createManagedPluginPaths(
  userDataDir: string
): ManagedPluginPaths {
  const pluginsDir = join(userDataDir, "plugins");
  return {
    indexFile: join(pluginsDir, "index.json"),
    installedDir: join(pluginsDir, "installed"),
    officialIndexCacheFile: join(pluginsDir, "official-index-cache.json"),
    operationLogFile: join(pluginsDir, "operation-log.jsonl"),
    pluginsDir,
    stagingDir: join(pluginsDir, "staging"),
    workDir: join(pluginsDir, "work"),
  };
}
