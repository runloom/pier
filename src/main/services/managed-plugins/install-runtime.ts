import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  ManagedPluginInstallIndexEntry,
  ManagedPluginPackageManifest,
} from "@shared/contracts/managed-plugin.ts";
import { assertPluginDataSchemaCompatibility } from "./data-schema-compatibility.ts";
import { computePackageContentHash } from "./package-content-hash.ts";
import {
  extractTgzSafely,
  validateManagedPluginPackage,
} from "./package-validation.ts";
import type { ManagedPluginPaths } from "./paths.ts";

/**
 * Runtime source materialization + installed-directory management for the
 * managed plugin install service. Extracted from install-service.ts to keep
 * that file under the file-size hard cap.
 */

export interface ManagedPluginRuntimeSource {
  readonly assetsRoot: string;
  readonly enabled: boolean;
  readonly id: string;
  readonly kind: "officialInstalled" | "devOverride";
  readonly mainEntryPath: string;
  readonly manifest: ManagedPluginPackageManifest;
  readonly rendererEntryUrl: string;
  readonly sourceRevision?: string;
  readonly version: string;
}

export interface RuntimeContext {
  readonly isDevRuntime: boolean;
  readonly paths: ManagedPluginPaths;
  readonly pierVersion: string;
}

async function computeDevSourceRevision(
  packageDir: string,
  manifest: ManagedPluginPackageManifest
): Promise<string> {
  const hash = createHash("sha256");
  hash.update(manifest.version);
  for (const relativePath of [
    "plugin.json",
    manifest.main,
    manifest.renderer,
  ]) {
    const filePath = join(packageDir, relativePath);
    try {
      const info = await stat(filePath);
      hash.update("\0");
      hash.update(relativePath);
      hash.update("\0");
      hash.update(String(info.size));
      hash.update("\0");
      hash.update(String(info.mtimeMs));
    } catch {
      hash.update("\0missing:");
      hash.update(relativePath);
    }
  }
  return hash.digest("hex").slice(0, 12);
}

export async function materializeRuntimeSource(
  ctx: RuntimeContext,
  pluginId: string,
  entry: ManagedPluginInstallIndexEntry
): Promise<ManagedPluginRuntimeSource | null> {
  const effective = entry.effectiveAtStartup;
  if (!effective) {
    return null;
  }
  if (effective.sourceKind === "devOverride" && !ctx.isDevRuntime) {
    return null;
  }
  const packageDir =
    effective.sourceKind === "devOverride" && entry.devOverride
      ? entry.devOverride.path
      : join(ctx.paths.installedDir, pluginId, effective.version);
  if (!existsSync(packageDir)) {
    return null;
  }
  try {
    const { manifest } = await validateManagedPluginPackage({
      packageDir,
      archivePath: null,
      expectedId: pluginId,
      expectedVersion: effective.version,
      expectedSha256: null,
      expectedSize: null,
      pierVersion: ctx.pierVersion,
    });
    await assertPluginDataSchemaCompatibility({
      manifest,
      pluginId,
      workDir: ctx.paths.workDir,
    });
    if (effective.sourceKind === "official") {
      const expectedContentHash =
        entry.installedVersions[effective.version]?.contentHash;
      if (
        !expectedContentHash ||
        (await computePackageContentHash(packageDir)) !== expectedContentHash
      ) {
        throw new Error(`installed plugin content hash mismatch: ${pluginId}`);
      }
    }
    const sourceRevision = ctx.isDevRuntime
      ? await computeDevSourceRevision(packageDir, manifest)
      : undefined;
    const rendererEntryUrl = `pier-plugin://${pluginId}/${effective.version}/${manifest.renderer}`;
    return {
      assetsRoot: packageDir,
      enabled: effective.enabled,
      id: pluginId,
      kind:
        effective.sourceKind === "devOverride"
          ? "devOverride"
          : "officialInstalled",
      manifest,
      mainEntryPath: join(packageDir, manifest.main),
      rendererEntryUrl: sourceRevision
        ? `${rendererEntryUrl}?rev=${sourceRevision}`
        : rendererEntryUrl,
      ...(sourceRevision ? { sourceRevision } : {}),
      version: effective.version,
    };
  } catch (error) {
    // Silent null previously made "installed but not loaded" undiagnosable.
    console.error(
      `[managed-plugins] materialize failed for ${pluginId}@${effective.version} (${effective.sourceKind}):`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

export interface PromoteInput {
  readonly id: string;
  readonly overwrite?: boolean;
  readonly packageDir: string;
  readonly version: string;
}

export async function promotePackageToInstalled(
  ctx: {
    readonly copyDirectory: (src: string, dest: string) => Promise<void>;
    readonly now: () => number;
    readonly paths: ManagedPluginPaths;
    readonly pierVersion: string;
  },
  input: PromoteInput
): Promise<void> {
  const targetDir = join(ctx.paths.installedDir, input.id, input.version);
  if (existsSync(targetDir)) {
    if (!input.overwrite) {
      return;
    }
    await rm(targetDir, { force: true, recursive: true });
  }
  const tempSibling = join(
    ctx.paths.installedDir,
    input.id,
    `.${input.version}.${ctx.now()}.${Math.floor(Math.random() * 1e6)}.tmp`
  );
  await mkdir(join(ctx.paths.installedDir, input.id), { recursive: true });
  await ctx.copyDirectory(input.packageDir, tempSibling);
  await validateManagedPluginPackage({
    packageDir: tempSibling,
    archivePath: null,
    expectedId: input.id,
    expectedVersion: input.version,
    expectedSha256: null,
    expectedSize: null,
    pierVersion: ctx.pierVersion,
  });
  await rename(tempSibling, targetDir);
}

/** Extract-based promote: `.tgz` → temp → validate → rename to installed target. */
export interface PromoteArchiveInput {
  readonly archivePath: string;
  readonly id: string;
  readonly overwrite?: boolean;
  readonly sha256: string | null;
  readonly size?: number;
  readonly version: string;
}

export async function promoteArchiveToInstalled(
  ctx: {
    readonly now: () => number;
    readonly paths: ManagedPluginPaths;
    readonly pierVersion: string;
  },
  input: PromoteArchiveInput
): Promise<void> {
  const targetDir = join(ctx.paths.installedDir, input.id, input.version);
  if (existsSync(targetDir)) {
    if (!input.overwrite) {
      return;
    }
    await rm(targetDir, { force: true, recursive: true });
  }
  const perPluginDir = join(ctx.paths.installedDir, input.id);
  await mkdir(perPluginDir, { recursive: true });
  const tempSibling = join(
    perPluginDir,
    `.${input.version}.${ctx.now()}.${Math.floor(Math.random() * 1e6)}.tmp`
  );
  await mkdir(tempSibling, { recursive: true });
  try {
    await extractTgzSafely(input.archivePath, tempSibling);
    await validateManagedPluginPackage({
      archivePath: input.archivePath,
      expectedId: input.id,
      expectedSha256: input.sha256,
      expectedSize: input.size ?? null,
      expectedVersion: input.version,
      packageDir: tempSibling,
      pierVersion: ctx.pierVersion,
    });
    await rename(tempSibling, targetDir);
  } catch (err) {
    await rm(tempSibling, { force: true, recursive: true });
    throw err;
  }
}

export async function defaultCopyDirectory(
  src: string,
  dest: string
): Promise<void> {
  await cp(src, dest, { errorOnExist: true, force: false, recursive: true });
}

export async function cleanupStalePromotionTemps(
  installedDir: string
): Promise<void> {
  if (!existsSync(installedDir)) {
    return;
  }
  const perPluginDirs = await readdir(installedDir, { withFileTypes: true });
  for (const dirent of perPluginDirs) {
    if (!dirent.isDirectory()) {
      continue;
    }
    const pluginDir = join(installedDir, dirent.name);
    const entries = await readdir(pluginDir, { withFileTypes: true });
    for (const inner of entries) {
      if (inner.name.startsWith(".") && inner.name.endsWith(".tmp")) {
        await rm(join(pluginDir, inner.name), { force: true, recursive: true });
      }
    }
  }
}
