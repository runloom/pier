import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { ManagedPluginPackageManifest } from "@shared/contracts/managed-plugin.ts";
import { assertPluginDataSchemaCompatibility } from "./data-schema-compatibility.ts";
import { computePackageContentHash } from "./package-content-hash.ts";
import { validateManagedPluginPackage } from "./package-validation.ts";
import type { ManagedPluginPaths } from "./paths.ts";

export async function validateInstalledCandidate(options: {
  expectedContentHash?: string;
  id: string;
  paths: ManagedPluginPaths;
  pierVersion: string;
  version: string;
}): Promise<ManagedPluginPackageManifest> {
  const { manifest } = await validateManagedPluginPackage({
    archivePath: null,
    expectedId: options.id,
    expectedSha256: null,
    expectedSize: null,
    expectedVersion: options.version,
    packageDir: join(options.paths.installedDir, options.id, options.version),
    pierVersion: options.pierVersion,
  });
  await assertPluginDataSchemaCompatibility({
    manifest,
    pluginId: options.id,
    workDir: options.paths.workDir,
  });
  if (
    options.expectedContentHash &&
    (await computePackageContentHash(
      join(options.paths.installedDir, options.id, options.version)
    )) !== options.expectedContentHash
  ) {
    throw new Error(
      `installed plugin content hash mismatch: ${options.id}@${options.version}`
    );
  }
  return manifest;
}

export async function removeNewCandidate(
  paths: ManagedPluginPaths,
  id: string,
  version: string,
  candidateAlreadyInstalled: boolean
): Promise<void> {
  if (candidateAlreadyInstalled) return;
  await rm(join(paths.installedDir, id, version), {
    force: true,
    recursive: true,
  });
}
