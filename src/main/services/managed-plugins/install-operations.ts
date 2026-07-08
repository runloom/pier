import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ManagedPluginOperationResult,
  OfficialPluginIndex,
} from "@shared/contracts/managed-plugin.ts";
import type { ManagedPluginIndexStore } from "./index-state.ts";
import { promoteArchiveToInstalled } from "./install-runtime.ts";
import { resolveInstallSource } from "./install-source-resolver.ts";
import type { ManagedPluginOperationLogRecord } from "./operation-log.ts";
import { validateManagedPluginPackage } from "./package-validation.ts";
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
    readonly dashboardWidgets: number;
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
  readonly officialIndexRefresh?: () => Promise<void>;
  readonly paths: ManagedPluginPaths;
  readonly pierVersion: string;
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
  // Already at the target version and not tombstoned — no-op in prod.
  if (
    existing?.activeVersion === source.version &&
    !existing.uninstalledAt &&
    !ctx.isDevRuntime
  ) {
    return {
      ok: true as const,
      pluginId: id,
      requiresRestart: false,
      version: source.version,
    };
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
        Boolean(existing?.uninstalledAt) ||
        existing?.activeVersion !== source.version,
      sha256: source.sha256,
      ...(source.size ? { size: source.size } : {}),
      version: source.version,
    }
  );
  ctx.store.mutate((s) => ({
    ...s,
    plugins: {
      ...s.plugins,
      [id]: {
        activeVersion: source.version,
        devOverride: null,
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
            installedAt: ctx.now(),
            packageUrl: source.packageUrl,
            sha256: source.sha256,
          },
        },
        pendingRestart: null,
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
    requiresRestart: false,
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
  ctx.store.mutate((s) => ({
    ...s,
    plugins: {
      ...s.plugins,
      [id]: {
        ...entry,
        enabled,
        pendingRestart: { kind: enabled ? "enable" : "disable" },
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
  return { ok: true as const, pluginId: id, requiresRestart: true };
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
        enabled: false,
        pendingRestart: { kind: "uninstall" },
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
  return { ok: true as const, pluginId: id, requiresRestart: true };
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

export async function performSetDevOverride(
  ctx: OperationsContext,
  id: string,
  path: string
): Promise<ManagedPluginOperationResult> {
  if (!ctx.isDevRuntime) {
    await ctx.appendOperationLog({
      actorKind: "desktop-renderer",
      operation: "devOverride.set",
      pluginId: id,
      result: "denied",
      timestamp: ctx.now(),
    });
    return {
      error: {
        code: "denied" as const,
        message: "dev override is not permitted in production runtime",
      },
      ok: false as const,
    };
  }
  let devVersion: string;
  try {
    const rawManifest = await readFile(join(path, "plugin.json"), "utf8");
    const parsed = JSON.parse(rawManifest) as { version?: string };
    if (typeof parsed.version !== "string") {
      throw new Error("plugin.json missing string version");
    }
    devVersion = parsed.version;
    await validateManagedPluginPackage({
      packageDir: path,
      archivePath: null,
      expectedId: id,
      expectedVersion: devVersion,
      expectedSha256: null,
      expectedSize: null,
      pierVersion: ctx.pierVersion,
    });
  } catch (err) {
    return {
      error: {
        code: "invalid_state" as const,
        message: `dev override package invalid: ${(err as Error).message}`,
      },
      ok: false as const,
    };
  }
  const state = ctx.store.get();
  const entry = state.plugins[id];
  const registeredAt = ctx.now();
  ctx.store.mutate((s) => ({
    ...s,
    plugins: {
      ...s.plugins,
      [id]: {
        activeVersion: entry?.activeVersion ?? null,
        devOverride: { path, registeredAt, version: devVersion },
        effectiveAtStartup: entry?.effectiveAtStartup ?? null,
        enabled: entry?.enabled ?? true,
        id,
        installedVersions: entry?.installedVersions ?? {},
        lastKnownGoodVersion: entry?.lastKnownGoodVersion ?? null,
        pendingRestart: { kind: "devOverride" },
        pendingUpdate: entry?.pendingUpdate ?? null,
        source: entry?.source ?? { kind: "devOverride" },
      },
    },
  }));
  await ctx.store.flush();
  await ctx.appendOperationLog({
    actorKind: "desktop-renderer",
    operation: "devOverride.set",
    pluginId: id,
    result: "success",
    timestamp: registeredAt,
  });
  return { ok: true as const, pluginId: id, requiresRestart: true };
}

export async function performClearDevOverride(
  ctx: OperationsContext,
  id: string
): Promise<ManagedPluginOperationResult> {
  if (!ctx.isDevRuntime) {
    return {
      error: {
        code: "denied" as const,
        message: "dev override is not permitted in production runtime",
      },
      ok: false as const,
    };
  }
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
  ctx.store.mutate((s) => ({
    ...s,
    plugins: {
      ...s.plugins,
      [id]: {
        ...entry,
        devOverride: null,
        pendingRestart: { kind: "devOverride" },
      },
    },
  }));
  await ctx.store.flush();
  await ctx.appendOperationLog({
    actorKind: "desktop-renderer",
    operation: "devOverride.clear",
    pluginId: id,
    result: "success",
    timestamp: ctx.now(),
  });
  return { ok: true as const, pluginId: id, requiresRestart: true };
}
