import { randomUUID } from "node:crypto";
import { lstat, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ensureProjectRelativeDir } from "../path-containment.ts";
import { computeTreeSha256V1 } from "../tree-digest.ts";
import { copySystemSkillTree } from "./copy-tree.ts";
import type { SystemSkillContribution } from "./index.ts";
import { resolveSystemSkillSourceDir } from "./source.ts";

/**
 * System-skill library content publication for Pier Home bindings (not
 * product system skills). Product skills install to `{userData}/skills/.system`.
 * Retired project snapshots of product skills are deleted when they digest
 * to a tree Pier published; anything else is quarantined.
 */

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

async function quarantineOrDeleteGrave(args: {
  grave: string;
  knownDigests: ReadonlySet<string>;
  officialDigest: string;
  projectRoot: string;
  skillId: string;
}): Promise<void> {
  let graveDigest: string | null = null;
  try {
    graveDigest = await computeTreeSha256V1(args.grave);
  } catch {
    graveDigest = null;
  }
  if (
    graveDigest !== null &&
    (args.knownDigests.has(graveDigest) || graveDigest === args.officialDigest)
  ) {
    await rm(args.grave, { force: true, recursive: true }).catch(
      () => undefined
    );
    return;
  }
  const quarantine = join(
    dirname(args.grave),
    `.pier-system-skill-quarantine-${Date.now()}-${args.skillId}`
  );
  await rename(args.grave, quarantine).catch(() => undefined);
  console.warn(
    "[project-skills] system skill content was modified outside Pier; retired copy preserved",
    { skillId: args.skillId, quarantine }
  );
}

/** Copy the immutable content dir into the project library (bindings). */
export async function publishSystemSkillContent(args: {
  projectRoot: string;
  contribution: SystemSkillContribution;
  /**
   * Dev-only Pier dogfood: may install `$projectRoot/resources/system-skills/<id>`
   * when that tree is gated. Production and bindings omit this.
   */
  preferProjectVendorSource?: boolean;
  /** Digests Pier itself published for this skill. */
  publishedDigests: readonly string[];
}): Promise<string> {
  const { projectRoot, contribution } = args;
  const sourceDir = await resolveSystemSkillSourceDir({
    allowProjectVendorSource: args.preferProjectVendorSource === true,
    fallbackContentDir: contribution.contentDir,
    projectRoot,
    skillId: contribution.id,
  });
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
  await copySystemSkillTree(sourceDir, tempDir);
  if (current === null) {
    await rename(tempDir, libraryDir);
  } else {
    const grave = `${tempDir}.old`;
    await rename(libraryDir, grave);
    try {
      await rename(tempDir, libraryDir);
    } catch (error) {
      await rename(grave, libraryDir).catch(() => undefined);
      await rm(tempDir, { force: true, recursive: true }).catch(
        () => undefined
      );
      throw error;
    }
    await quarantineOrDeleteGrave({
      grave,
      knownDigests,
      officialDigest: sourceDigest,
      projectRoot,
      skillId: contribution.id,
    });
  }
  await sweepOfficialSystemSkillQuarantines(
    projectRoot,
    contribution.id,
    sourceDigest
  );
  return sourceDigest;
}

/**
 * Remove a product-skill snapshot previously copied into the project library.
 * Known official trees are deleted; unknown bytes are quarantined.
 */
export async function retireProjectSystemSkillLibrary(args: {
  officialDigest: string;
  projectRoot: string;
  publishedDigests: readonly string[];
  skillId: string;
}): Promise<void> {
  const { projectRoot, skillId, officialDigest } = args;
  const libraryDir = join(projectRoot, ".pier", "skills", "library", skillId);
  const current = await libraryDigest(projectRoot, skillId);
  if (current === null) {
    await sweepOfficialSystemSkillQuarantines(
      projectRoot,
      skillId,
      officialDigest
    );
    return;
  }
  const knownDigests = new Set(args.publishedDigests);
  const grave = join(
    dirname(libraryDir),
    `.pier-system-skill-${process.pid}-${randomUUID()}.tmp.old`
  );
  await rename(libraryDir, grave);
  await quarantineOrDeleteGrave({
    grave,
    knownDigests,
    officialDigest,
    projectRoot,
    skillId,
  });
  await sweepOfficialSystemSkillQuarantines(
    projectRoot,
    skillId,
    officialDigest
  );
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
