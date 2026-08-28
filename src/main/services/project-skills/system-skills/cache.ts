import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { computeTreeSha256V1 } from "../tree-digest.ts";
import { systemSkillsCacheRoot } from "./cache-root.ts";
import { copySystemSkillTree } from "./copy-tree.ts";
import type { SystemSkillContribution } from "./index.ts";
import { resolveSystemSkillSourceDir } from "./source.ts";

const MARKER_VERSION = "v1";

export {
  migrateLegacySystemSkillsCacheRoot,
  resetSystemSkillsCacheRootForTests,
  setSystemSkillsCacheRootForHost,
  systemSkillsCacheRoot,
} from "./cache-root.ts";

export function systemSkillCacheDir(userData: string, skillId: string): string {
  return join(systemSkillsCacheRoot(userData), skillId);
}

export function systemSkillCacheMarkerPath(
  userData: string,
  skillId: string
): string {
  return join(systemSkillsCacheRoot(userData), `${skillId}.marker`);
}

export function systemSkillCacheFingerprint(args: {
  providerId: string;
  providerVersion: string;
  sourceDigest: string;
}): string {
  return [
    MARKER_VERSION,
    `${args.providerId}@${args.providerVersion}`,
    args.sourceDigest,
    "",
  ].join("\n");
}

async function readMarker(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Install one system skill into `{systemSkillsCacheRoot}/<id>/`(宿主注入
 * `~/.pier/system-skills`;Codex `$CODEX_HOME/skills/.system` analogue)。
 * Fingerprint skip when the marker matches this process's official source.
 */
export async function installSystemSkillCache(args: {
  contribution: SystemSkillContribution;
  preferProjectVendorSource?: boolean;
  projectRoot: string;
  userData: string;
}): Promise<{ cacheDir: string; digest: string }> {
  const { contribution, userData, projectRoot } = args;
  const sourceDir = await resolveSystemSkillSourceDir({
    allowProjectVendorSource: args.preferProjectVendorSource === true,
    fallbackContentDir: contribution.contentDir,
    projectRoot,
    skillId: contribution.id,
  });
  const sourceDigest = await computeTreeSha256V1(sourceDir);
  const cacheDir = resolve(systemSkillCacheDir(userData, contribution.id));
  const markerPath = systemSkillCacheMarkerPath(userData, contribution.id);
  const fingerprint = systemSkillCacheFingerprint({
    providerId: contribution.provider.id,
    providerVersion: contribution.provider.version,
    sourceDigest,
  });
  const existingMarker = await readMarker(markerPath);
  if (existingMarker === fingerprint) {
    try {
      const info = await lstat(cacheDir);
      if (info.isDirectory() && !info.isSymbolicLink()) {
        return {
          cacheDir,
          digest: await computeTreeSha256V1(cacheDir),
        };
      }
    } catch {
      // Missing cache dir with a stale marker — reinstall.
    }
  }

  const parent = dirname(cacheDir);
  await mkdir(parent, { recursive: true });
  const tempDir = join(
    parent,
    `.tmp-${process.pid}-${randomUUID()}-${contribution.id}`
  );
  await copySystemSkillTree(sourceDir, tempDir);

  let hadExisting = false;
  try {
    await lstat(cacheDir);
    hadExisting = true;
  } catch {
    hadExisting = false;
  }
  const grave = hadExisting ? `${tempDir}.old` : null;
  if (grave) {
    await rename(cacheDir, grave);
  }
  try {
    await rename(tempDir, cacheDir);
  } catch (error) {
    if (grave) {
      await rename(grave, cacheDir).catch(() => undefined);
    }
    await rm(tempDir, { force: true, recursive: true }).catch(() => undefined);
    throw error;
  }
  if (grave) {
    await rm(grave, { force: true, recursive: true }).catch(() => undefined);
  }
  await writeFile(markerPath, fingerprint, { encoding: "utf8", mode: 0o644 });
  return { cacheDir, digest: await computeTreeSha256V1(cacheDir) };
}
