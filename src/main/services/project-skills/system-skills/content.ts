import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { ensureProjectRelativeDir } from "../path-containment.ts";
import { computeTreeSha256V1 } from "../tree-digest.ts";
import type { SystemSkillContribution } from "./index.ts";

/**
 * System-skill library content publication (design v8 §8 / §9 discipline):
 * the project library is a projection of this process's official source.
 * Refresh always writes that source. Retired snapshots are deleted when they
 * digest to a tree Pier published (or already match the source); anything
 * else is quarantined, never destroyed. Duplicate official quarantine dirs
 * are swept. Split from system-skills.ts (file-size cap).
 */

/**
 * When the project itself vendors `resources/system-skills/<id>` (Pier
 * dogfood), that tree is the official source — not a stale app bundle.
 * Live projection is always `.pier/skills/library/<id>` (`pier-*`).
 */
async function resolvePublishSourceDir(
  projectRoot: string,
  contribution: SystemSkillContribution
): Promise<string> {
  const projectSource = join(
    projectRoot,
    "resources",
    "system-skills",
    contribution.id
  );
  try {
    const skillMd = await lstat(join(projectSource, "SKILL.md"));
    if (skillMd.isFile()) {
      return projectSource;
    }
  } catch {
    // Fall through to the registered contribution tree.
  }
  return contribution.contentDir;
}

async function libraryDigest(
  projectRoot: string,
  skillId: string
): Promise<string | null> {
  const dir = join(projectRoot, ".pier", "skills", "library", skillId);
  try {
    await lstat(dir);
  } catch {
    return null;
  }
  try {
    return await computeTreeSha256V1(dir);
  } catch {
    return null;
  }
}

/** Drop quarantine copies that are just the official tree we just published. */
async function sweepOfficialSystemSkillQuarantines(
  projectRoot: string,
  skillId: string,
  officialDigest: string
): Promise<void> {
  const libraryParent = join(projectRoot, ".pier", "skills", "library");
  let entries: string[] = [];
  try {
    entries = await readdir(libraryParent);
  } catch {
    return;
  }
  const suffix = `-${skillId}`;
  for (const entry of entries) {
    if (!entry.startsWith(".pier-system-skill-quarantine-")) continue;
    if (!entry.endsWith(suffix)) continue;
    const absolute = join(libraryParent, entry);
    try {
      const digest = await computeTreeSha256V1(absolute);
      if (digest === officialDigest) {
        await rm(absolute, { force: true, recursive: true });
      }
    } catch {
      // Leave unreadable evidence in place.
    }
  }
}

/** Copy the immutable content dir into the project library (no-replace or
 * version refresh). Refresh swaps via temp + rename of a fresh copy; the
 * retired snapshot is only removed after the swap succeeded. */
export async function publishSystemSkillContent(args: {
  projectRoot: string;
  contribution: SystemSkillContribution;
  /**
   * System-skills channel only: Pier dogfood may publish
   * `$projectRoot/resources/system-skills/<id>` instead of the bundle.
   * Bindings must omit this and always use `contribution.contentDir`.
   */
  preferProjectVendorSource?: boolean;
  /** Digests Pier itself published for this skill. */
  publishedDigests: readonly string[];
}): Promise<string> {
  const { projectRoot, contribution } = args;
  const sourceDir = args.preferProjectVendorSource
    ? await resolvePublishSourceDir(projectRoot, contribution)
    : contribution.contentDir;
  const sourceDigest = await computeTreeSha256V1(sourceDir);
  const libraryDir = join(
    projectRoot,
    ".pier",
    "skills",
    "library",
    contribution.id
  );
  const current = await libraryDigest(projectRoot, contribution.id);
  if (current === sourceDigest) {
    await sweepOfficialSystemSkillQuarantines(
      projectRoot,
      contribution.id,
      sourceDigest
    );
    return sourceDigest;
  }
  const knownDigests = new Set(args.publishedDigests);
  const tempDir = join(
    dirname(libraryDir),
    `.pier-system-skill-${process.pid}-${randomUUID()}.tmp`
  );
  await ensureProjectRelativeDir(projectRoot, ".pier/skills/library");
  await copyTree(sourceDir, tempDir);
  if (current === null) {
    await rename(tempDir, libraryDir);
  } else {
    // Version refresh: retire old snapshot to a temp grave, then swap.
    const grave = `${tempDir}.old`;
    await rename(libraryDir, grave);
    try {
      await rename(tempDir, libraryDir);
    } catch (error) {
      // Restore on failure; never leave the library half-swapped.
      await rename(grave, libraryDir).catch(() => undefined);
      await rm(tempDir, { force: true, recursive: true }).catch(
        () => undefined
      );
      throw error;
    }
    // Library is a projection of official content. Known official snapshots
    // (and a grave that already matches the source) are deleted. Anything
    // else is quarantined — never a blind recursive delete of unknown bytes.
    let graveDigest: string | null = null;
    try {
      graveDigest = await computeTreeSha256V1(grave);
    } catch {
      graveDigest = null;
    }
    if (
      graveDigest !== null &&
      (knownDigests.has(graveDigest) || graveDigest === sourceDigest)
    ) {
      await rm(grave, { force: true, recursive: true }).catch(() => undefined);
    } else {
      const quarantine = join(
        dirname(libraryDir),
        `.pier-system-skill-quarantine-${Date.now()}-${contribution.id}`
      );
      await rename(grave, quarantine).catch(() => undefined);
      console.warn(
        "[project-skills] system skill content was modified outside Pier; retired copy preserved",
        { skillId: contribution.id, quarantine }
      );
    }
  }
  await sweepOfficialSystemSkillQuarantines(
    projectRoot,
    contribution.id,
    sourceDigest
  );
  return sourceDigest;
}

/** Best-effort sweep of stale swap leftovers (crash debris, >24h old). */
export async function sweepSystemSkillSwapLeftovers(
  projectRoot: string
): Promise<void> {
  const libraryParent = join(projectRoot, ".pier", "skills", "library");
  let entries: string[] = [];
  try {
    entries = await readdir(libraryParent);
  } catch {
    return;
  }
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const entry of entries) {
    if (!entry.startsWith(".pier-system-skill-")) continue;
    // Quarantine directories are preserved evidence — never swept.
    if (entry.startsWith(".pier-system-skill-quarantine-")) continue;
    const absolute = join(libraryParent, entry);
    try {
      const info = await lstat(absolute);
      if (info.mtimeMs < cutoff) {
        await rm(absolute, { force: true, recursive: true });
      }
    } catch {
      // Diagnostics-only sweep.
    }
  }
}

async function copyTree(sourceDir: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(sourceDir);
  for (const entryName of entries) {
    const src = join(sourceDir, entryName);
    const dst = join(destDir, entryName);
    const info = await lstat(src);
    if (info.isSymbolicLink()) {
      throw new Error(`system skill content must not contain symlinks: ${src}`);
    }
    if (info.isDirectory()) {
      await copyTree(src, dst);
      continue;
    }
    if (!info.isFile()) {
      throw new Error(`system skill content has special file: ${src}`);
    }
    const bytes = await readFile(src);
    await writeFile(dst, bytes, {
      // biome-ignore lint/suspicious/noBitwiseOperators: POSIX mode mask
      mode: info.mode & 0o111 ? 0o755 : 0o644,
      flag: "w",
    });
  }
}
