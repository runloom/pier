import { join } from "node:path";
import type {
  ManagedPluginOperationResult,
  OfficialPluginIndex,
} from "@shared/contracts/managed-plugin.ts";
import type { ManagedPluginIndexStore } from "./index-state.ts";
import { promoteArchiveToInstalled } from "./install-runtime.ts";
import { resolveInstallSource } from "./install-source-resolver.ts";
import {
  removeNewCandidate,
  validateInstalledCandidate,
} from "./installed-candidate-validation.ts";
import type { ManagedPluginOperationLogRecord } from "./operation-log.ts";
import { computePackageContentHash } from "./package-content-hash.ts";
import type { ManagedPluginPaths } from "./paths.ts";

/**
 * Individual operation implementations for the managed plugin install service.
 * Extracted from install-service.ts to keep that file under the file-size
 * hard cap. Each operation takes an OperationsContext + args and returns a
 * `ManagedPluginOperationResult`.
 */

export interface BundledPluginRegistration {
  /** Absolute path to the pre-built `.tgz`. */
  readonly archivePath: string;
  readonly contributionCounts?: {
    readonly commands: number;
    readonly workbenchWidgets: number;
    readonly panels: number;
    readonly terminalStatusItems: number;
  };
  readonly description?: string;
  readonly displayName: string;
  readonly id: string;
  /** Per-locale name/description overrides shipped in `plugin.json`. */
  readonly locales?: Record<string, { name?: string; description?: string }>;
  /** sha256 hex digest of the archive; enforced by validation. */
  readonly sha256: string;
  readonly size?: number;
  readonly version: string;
}

export type AssetFetcher = (url: string) => Promise<{
  body: Buffer;
  finalUrl: string;
  redirectCount: number;
}>;

export interface OperationsContext {
  readonly appendOperationLog: (
    record: ManagedPluginOperationLogRecord
  ) => Promise<void>;
  /** HTTP downloader for official plugin assets. Missing → HTTP install disabled. */
  readonly assetFetcher?: AssetFetcher;
  readonly bundledPlugins: readonly BundledPluginRegistration[];
  readonly copyDirectory: (src: string, dest: string) => Promise<void>;
  readonly isDevRuntime: boolean;
  readonly now: () => number;
  readonly officialIndexProvider: () => OfficialPluginIndex | null;
  /** Ensures the officialIndex is fresh before an install (called before HTTP fetch). */
  readonly officialIndexRefresh?: (options?: {
    force?: boolean;
  }) => Promise<void>;
  readonly paths: ManagedPluginPaths;
  readonly pierVersion: string;
  /**
   * `workspace` = local package isolation; `release` = production-like installs.
   * Defaults to release when omitted (tests / production).
   */
  readonly pluginMode?: "workspace" | "release";
  readonly refreshRuntimeSnapshot: () => Promise<void>;
  readonly store: ManagedPluginIndexStore;
}

/**
 * User-initiated install. Attempts HTTP fetch of the official version first
 * (when a fetcher + official index are configured), falls back to the bundled
 * archive. Extracts, validates, promotes to `installed/<id>/<version>/`, and
 * clears any tombstone from a prior uninstall.
 */
export async function performInstall(
  ctx: OperationsContext,
  id: string
): Promise<ManagedPluginOperationResult> {
  const bundled = ctx.bundledPlugins.find((entry) => entry.id === id);
  if (!bundled) {
    return {
      error: {
        code: "not_found" as const,
        message: `no install source for plugin: ${id}`,
      },
      ok: false as const,
    };
  }
  const state = ctx.store.get();
  const existing = state.plugins[id];
  const source = await resolveInstallSource(ctx, bundled);
  const isInstalledUpdate = Boolean(
    existing?.activeVersion &&
      existing.activeVersion !== source.version &&
      !existing.uninstalledAt
  );
  const candidateAlreadyInstalled = Boolean(
    existing?.installedVersions[source.version]
  );
  let targetNeedsRepair = false;
  // Already at the target version and not tombstoned — no-op in prod.
  if (
    existing?.activeVersion === source.version &&
    !existing.uninstalledAt &&
    !ctx.isDevRuntime
  ) {
    try {
      const expectedContentHash =
        existing.installedVersions[source.version]?.contentHash;
      await validateInstalledCandidate({
        ...(expectedContentHash ? { expectedContentHash } : {}),
        id,
        paths: ctx.paths,
        pierVersion: ctx.pierVersion,
        version: source.version,
      });
      return {
        ok: true as const,
        pluginId: id,
        requiresRestart: false,
        version: source.version,
      };
    } catch {
      targetNeedsRepair = true;
    }
  }
  await promoteArchiveToInstalled(
    {
      now: ctx.now,
      paths: ctx.paths,
      pierVersion: ctx.pierVersion,
    },
    {
      archivePath: source.archivePath,
      id,
      overwrite:
        ctx.isDevRuntime ||
        targetNeedsRepair ||
        Boolean(existing?.uninstalledAt) ||
        existing?.activeVersion !== source.version,
      sha256: source.sha256,
      ...(source.size ? { size: source.size } : {}),
      version: source.version,
    }
  );
  try {
    await validateInstalledCandidate({
      id,
      paths: ctx.paths,
      pierVersion: ctx.pierVersion,
      version: source.version,
    });
  } catch (error) {
    await removeNewCandidate(
      ctx.paths,
      id,
      source.version,
      candidateAlreadyInstalled
    );
    await ctx.appendOperationLog({
      actorKind: "desktop-renderer",
      operation: source.logKind,
      pluginId: id,
      result: "failed",
      timestamp: ctx.now(),
      toVersion: source.version,
    });
    return {
      error: {
        code: "invalid_state" as const,
        message: error instanceof Error ? error.message : String(error),
      },
      ok: false as const,
    };
  }
  const contentHash = await computePackageContentHash(
    join(ctx.paths.installedDir, id, source.version)
  );
  ctx.store.mutate((s) => ({
    ...s,
    plugins: {
      ...s.plugins,
      [id]: {
        activeVersion: source.version,
        // Workspace mode keeps an existing override across reinstall so
        // "Install" cannot pin runtime back to a release snapshot.
        devOverride:
          ctx.pluginMode === "workspace"
            ? (existing?.devOverride ?? null)
            : null,
        effectiveAtStartup: existing?.effectiveAtStartup ?? {
          enabled: true,
          sourceKind: "official",
          version: source.version,
        },
        enabled: true,
        id,
        installedVersions: {
          ...(existing?.installedVersions ?? {}),
          [source.version]: {
            contentHash,
            installedAt: ctx.now(),
            packageUrl: source.packageUrl,
            sha256: source.sha256,
            verifiedHash: source.sha256,
          },
        },
        pendingRestart: isInstalledUpdate
          ? { kind: "update", version: source.version }
          : null,
        pendingUpdate: null,
        source: {
          kind: "official",
          seededFromBundle: source.logKind === "install-from-bundle",
        },
        uninstalledAt: undefined,
      },
    },
  }));
  await ctx.store.flush();
  await ctx.appendOperationLog({
    actorKind: "desktop-renderer",
    operation: source.logKind,
    pluginId: id,
    result: "success",
    sha256: source.sha256,
    timestamp: ctx.now(),
    toVersion: source.version,
  });
  await ctx.refreshRuntimeSnapshot();
  return {
    ok: true as const,
    pluginId: id,
    requiresRestart: isInstalledUpdate,
    version: source.version,
  };
}

export async function setEnabledFlag(
  ctx: OperationsContext,
  id: string,
  enabled: boolean
): Promise<ManagedPluginOperationResult> {
  const state = ctx.store.get();
  const entry = state.plugins[id];
  if (!entry) {
    return {
      error: {
        code: "not_found" as const,
        message: `plugin ${id} not installed`,
      },
      ok: false as const,
    };
  }
  const sourceKind =
    entry.effectiveAtStartup?.sourceKind ??
    (entry.devOverride && ctx.isDevRuntime ? "devOverride" : "official");
  const effectiveVersion =
    entry.effectiveAtStartup?.version ??
    (sourceKind === "devOverride"
      ? (entry.devOverride?.version ?? entry.activeVersion)
      : entry.activeVersion);
  const desiredSourceKind =
    entry.devOverride && ctx.isDevRuntime ? "devOverride" : "official";
  const desiredVersion =
    desiredSourceKind === "devOverride"
      ? (entry.devOverride?.version ?? entry.activeVersion)
      : entry.activeVersion;
  const keepPendingRestart = Boolean(
    entry.pendingRestart &&
      effectiveVersion &&
      desiredVersion &&
      (sourceKind !== desiredSourceKind || effectiveVersion !== desiredVersion)
  );
  ctx.store.mutate((s) => ({
    ...s,
    plugins: {
      ...s.plugins,
      [id]: {
        ...entry,
        effectiveAtStartup: effectiveVersion
          ? {
              enabled,
              sourceKind,
              version: effectiveVersion,
            }
          : null,
        enabled,
        pendingRestart: keepPendingRestart ? entry.pendingRestart : null,
      },
    },
  }));
  await ctx.store.flush();
  await ctx.appendOperationLog({
    actorKind: "desktop-renderer",
    operation: enabled ? "enable" : "disable",
    pluginId: id,
    result: "success",
    timestamp: ctx.now(),
  });
  await ctx.refreshRuntimeSnapshot();
  return { ok: true as const, pluginId: id, requiresRestart: false };
}

export async function performUninstall(
  ctx: OperationsContext,
  id: string
): Promise<ManagedPluginOperationResult> {
  const state = ctx.store.get();
  const entry = state.plugins[id];
  if (!entry) {
    return {
      error: {
        code: "not_found" as const,
        message: `plugin ${id} not installed`,
      },
      ok: false as const,
    };
  }
  const fromVersion = entry.activeVersion;
  ctx.store.mutate((s) => ({
    ...s,
    plugins: {
      ...s.plugins,
      [id]: {
        ...entry,
        activeVersion: null,
        effectiveAtStartup: null,
        enabled: false,
        pendingRestart: null,
        uninstalledAt: ctx.now(),
      },
    },
  }));
  await ctx.store.flush();
  await ctx.appendOperationLog({
    actorKind: "desktop-renderer",
    ...(fromVersion ? { fromVersion } : {}),
    operation: "uninstall",
    pluginId: id,
    result: "success",
    timestamp: ctx.now(),
  });
  await ctx.refreshRuntimeSnapshot();
  return { ok: true as const, pluginId: id, requiresRestart: false };
}

export async function performRollback(
  ctx: OperationsContext,
  id: string,
  version: string
): Promise<ManagedPluginOperationResult> {
  const state = ctx.store.get();
  const entry = state.plugins[id];
  if (!entry) {
    return {
      error: {
        code: "not_found" as const,
        message: `plugin ${id} not installed`,
      },
      ok: false as const,
    };
  }
  if (!entry.installedVersions[version]) {
    return {
      error: {
        code: "not_found" as const,
        message: `version ${version} not installed for ${id}`,
      },
      ok: false as const,
    };
  }
  try {
    await validateInstalledCandidate({
      ...(entry.installedVersions[version]?.contentHash
        ? {
            expectedContentHash: entry.installedVersions[version].contentHash,
          }
        : {}),
      id,
      paths: ctx.paths,
      pierVersion: ctx.pierVersion,
      version,
    });
  } catch (error) {
    return {
      error: {
        code: "invalid_state" as const,
        message: error instanceof Error ? error.message : String(error),
      },
      ok: false as const,
    };
  }
  const fromVersion = entry.activeVersion;
  ctx.store.mutate((s) => ({
    ...s,
    plugins: {
      ...s.plugins,
      [id]: {
        ...entry,
        activeVersion: version,
        pendingRestart: { kind: "rollback", version },
      },
    },
  }));
  await ctx.store.flush();
  await ctx.appendOperationLog({
    actorKind: "desktop-renderer",
    ...(fromVersion ? { fromVersion } : {}),
    operation: "rollback",
    pluginId: id,
    result: "success",
    timestamp: ctx.now(),
    toVersion: version,
  });
  return {
    ok: true as const,
    pluginId: id,
    requiresRestart: true,
    version,
  };
}
