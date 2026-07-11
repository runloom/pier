import { join } from "node:path";
import type { ManagedPluginOperationResult } from "@shared/contracts/managed-plugin.ts";
import type { OperationsContext } from "./install-operations.ts";
import { promoteArchiveToInstalled } from "./install-runtime.ts";
import { resolveOfficialUpdateSource } from "./install-source-resolver.ts";
import {
  removeNewCandidate,
  validateInstalledCandidate,
} from "./installed-candidate-validation.ts";
import { computePackageContentHash } from "./package-content-hash.ts";

export async function performUpdate(
  ctx: OperationsContext,
  id: string
): Promise<ManagedPluginOperationResult> {
  const state = ctx.store.get();
  const existing = state.plugins[id];
  if (!existing?.activeVersion || existing.uninstalledAt) {
    await ctx.appendOperationLog({
      actorKind: "desktop-renderer",
      operation: "update",
      pluginId: id,
      result: "failed",
      timestamp: ctx.now(),
    });
    return {
      error: {
        code: "invalid_state" as const,
        message: `plugin ${id} is not installed`,
      },
      ok: false as const,
    };
  }
  const resolved = await resolveOfficialUpdateSource(ctx, id);
  if (!resolved.ok) {
    await ctx.appendOperationLog({
      actorKind: "desktop-renderer",
      operation: "update",
      pluginId: id,
      result: "failed",
      timestamp: ctx.now(),
    });
    return {
      error: {
        code: resolved.error.code,
        message: resolved.error.message,
      },
      ok: false as const,
    };
  }
  const source = resolved.source;
  const candidateAlreadyInstalled = Boolean(
    existing.installedVersions[source.version]
  );
  if (source.version === existing.activeVersion) {
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
      // A verified archive is already staged by resolveOfficialUpdateSource;
      // continue through the normal overwrite/validation transaction to heal
      // the installed candidate instead of reporting a false no-op success.
    }
  }
  try {
    await promoteArchiveToInstalled(
      {
        now: ctx.now,
        paths: ctx.paths,
        pierVersion: ctx.pierVersion,
      },
      {
        archivePath: source.archivePath,
        id,
        overwrite: true,
        sha256: source.sha256,
        size: source.size,
        version: source.version,
      }
    );
  } catch (err) {
    await ctx.appendOperationLog({
      actorKind: "desktop-renderer",
      fromVersion: existing.activeVersion,
      operation: "update",
      pluginId: id,
      result: "failed",
      timestamp: ctx.now(),
      toVersion: source.version,
    });
    return {
      error: {
        code: "internal_error" as const,
        message: `failed to promote plugin update: ${(err as Error).message}`,
      },
      ok: false as const,
    };
  }
  let hotReload: boolean;
  let contentHash: string;
  try {
    const manifest = await validateInstalledCandidate({
      id,
      paths: ctx.paths,
      pierVersion: ctx.pierVersion,
      version: source.version,
    });
    hotReload = manifest.runtime?.reloadPolicy === "hot";
    contentHash = await computePackageContentHash(
      join(ctx.paths.installedDir, id, source.version)
    );
  } catch (error) {
    await removeNewCandidate(
      ctx.paths,
      id,
      source.version,
      candidateAlreadyInstalled
    );
    await ctx.appendOperationLog({
      actorKind: "desktop-renderer",
      fromVersion: existing.activeVersion,
      operation: "update",
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
  ctx.store.mutate((s) => ({
    ...s,
    plugins: {
      ...s.plugins,
      [id]: {
        ...existing,
        activeVersion: source.version,
        devOverride: null,
        effectiveAtStartup: hotReload
          ? {
              enabled: true,
              sourceKind: "official",
              version: source.version,
            }
          : existing.effectiveAtStartup,
        enabled: true,
        installedVersions: {
          ...existing.installedVersions,
          [source.version]: {
            contentHash,
            installedAt: ctx.now(),
            packageUrl: source.packageUrl,
            sha256: source.sha256,
            verifiedHash: source.sha256,
          },
        },
        pendingRestart: hotReload
          ? null
          : { kind: "update", version: source.version },
        pendingUpdate: null,
        source: { kind: "official" },
        uninstalledAt: undefined,
      },
    },
  }));
  await ctx.store.flush();
  await ctx.appendOperationLog({
    actorKind: "desktop-renderer",
    assetUrl: source.assetUrl,
    fromVersion: existing.activeVersion,
    officialIndexSequence: source.officialIndexSequence,
    operation: "update",
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
    requiresRestart: !hotReload,
    version: source.version,
  };
}
