import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type {
  ManagedPluginInstallIndex,
  ManagedPluginInstallIndexEntry,
  ManagedPluginOperationResult,
} from "@shared/contracts/managed-plugin.ts";

/**
 * Workspace-local plugin development isolation (first-party + user custom).
 *
 * In `workspace` mode, plugins load from package directories (devOverride), not
 * from frozen installed/<id>/<version> or GitHub releases.
 */

export interface WorkspaceDevPluginSpec {
  readonly devPackageDir: string;
  readonly id: string;
}

export interface WorkspaceDevPluginSyncOptions {
  readonly applyEffective: () => Promise<void>;
  readonly cwd: string;
  /**
   * When a first-party workspace package is ready but missing/uninstalled,
   * install from the local bundled tgz (workspace mode prefers bundle over HTTP).
   */
  readonly ensureInstalled?: (
    id: string
  ) => Promise<ManagedPluginOperationResult>;
  readonly getIndex: () => ManagedPluginInstallIndex;
  readonly logger?: {
    error: (message: string, meta?: unknown) => void;
    info?: (message: string, meta?: unknown) => void;
  };
  /**
   * Seed a store entry for custom workspace plugins that have no bundled tgz
   * (path-only development).
   */
  readonly seedWorkspaceEntry?: (id: string, version: string) => Promise<void>;
  readonly setDevOverride: (
    id: string,
    path: string
  ) => Promise<ManagedPluginOperationResult>;
  readonly specs: readonly WorkspaceDevPluginSpec[];
}

export function workspacePackageDir(
  cwd: string,
  spec: WorkspaceDevPluginSpec
): string {
  return isAbsolute(spec.devPackageDir)
    ? spec.devPackageDir
    : join(cwd, spec.devPackageDir);
}

export function isWorkspacePluginPackageReady(
  packageDir: string,
  mainEntry = "dist/main.js"
): boolean {
  return (
    existsSync(join(packageDir, "plugin.json")) &&
    existsSync(join(packageDir, mainEntry))
  );
}

export function readWorkspacePackageVersion(packageDir: string): string | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(packageDir, "plugin.json"), "utf8")
    ) as { version?: unknown };
    return typeof raw.version === "string" && raw.version.length > 0
      ? raw.version
      : null;
  } catch {
    return null;
  }
}

function isInstalledActive(
  index: ManagedPluginInstallIndex,
  id: string
): boolean {
  const entry = index.plugins[id];
  return Boolean(entry?.activeVersion && !entry.uninstalledAt);
}

/**
 * Ensure workspace plugins are installed (or path-seeded) and pinned via
 * devOverride. Safe to call repeatedly.
 */
export async function syncWorkspaceDevPluginOverrides(
  options: WorkspaceDevPluginSyncOptions
): Promise<{ applied: string[]; skipped: string[] }> {
  const applied: string[] = [];
  const skipped: string[] = [];
  let needsApply = false;

  for (const spec of options.specs) {
    const packageDir = workspacePackageDir(options.cwd, spec);
    if (!isWorkspacePluginPackageReady(packageDir)) {
      options.logger?.error?.(
        `[managed-plugins] ${spec.id} workspace package not ready at ${packageDir} (need plugin.json + dist/main.js; run plugin watch or plugins:pack)`
      );
      skipped.push(spec.id);
      continue;
    }

    if (!isInstalledActive(options.getIndex(), spec.id)) {
      if (options.ensureInstalled) {
        const installed = await options.ensureInstalled(spec.id);
        if (installed.ok) {
          options.logger?.info?.(
            `[managed-plugins] ${spec.id} installed from workspace bundle`
          );
          needsApply = true;
        } else {
          // First-party install can fail; custom plugins often have no tgz.
          // setDevOverride path-seeds an index entry when still missing.
          options.logger?.info?.(
            `[managed-plugins] ${spec.id} ensure-install skipped: ${installed.error.message}`
          );
        }
      }
      if (
        !isInstalledActive(options.getIndex(), spec.id) &&
        options.seedWorkspaceEntry
      ) {
        const version = readWorkspacePackageVersion(packageDir);
        if (version) {
          await options.seedWorkspaceEntry(spec.id, version);
          options.logger?.info?.(
            `[managed-plugins] ${spec.id} seeded workspace entry v${version}`
          );
          needsApply = true;
        }
      }
    }

    const entry = options.getIndex().plugins[spec.id];
    const existing = entry?.devOverride;
    const packageVersion = readWorkspacePackageVersion(packageDir);
    const overrideVersionMatches =
      packageVersion !== null && existing?.version === packageVersion;
    if (
      existing?.path === packageDir &&
      overrideVersionMatches &&
      entry?.effectiveAtStartup?.sourceKind === "devOverride" &&
      entry.activeVersion &&
      !entry.uninstalledAt
    ) {
      applied.push(spec.id);
      continue;
    }
    if (
      existing?.path === packageDir &&
      overrideVersionMatches &&
      entry?.activeVersion &&
      !entry.uninstalledAt
    ) {
      applied.push(spec.id);
      needsApply = true;
      continue;
    }

    // setDevOverride validates plugin.json, matches id, and path-seeds when
    // the plugin has no prior install (friendly path for custom roots).
    const result = await options.setDevOverride(spec.id, packageDir);
    if (!result.ok) {
      options.logger?.error?.(
        `[managed-plugins] ${spec.id} workspace dev override failed: ${result.error.message}`
      );
      skipped.push(spec.id);
      continue;
    }
    applied.push(spec.id);
    needsApply = true;
    options.logger?.info?.(
      `[managed-plugins] ${spec.id} → workspace devOverride ${packageDir}`
    );
  }

  if (needsApply) {
    await options.applyEffective();
  }
  return { applied, skipped };
}

/** Build a minimal index entry for path-only custom workspace plugins. */
export function createSeededWorkspaceIndexEntry(
  id: string,
  version: string,
  now: number
): ManagedPluginInstallIndexEntry {
  return {
    activeVersion: version,
    devOverride: null,
    effectiveAtStartup: null,
    enabled: true,
    id,
    installedVersions: {
      [version]: {
        contentHash: `workspace-seed:${id}@${version}`,
        installedAt: now,
        packageUrl: `workspace://${id}/${version}`,
        sha256: `workspace-seed:${id}@${version}`,
      },
    },
    lastKnownGoodVersion: null,
    pendingRestart: null,
    pendingUpdate: null,
    source: { kind: "devOverride" },
  };
}
