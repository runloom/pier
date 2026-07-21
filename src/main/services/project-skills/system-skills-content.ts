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
import { ensureProjectRelativeDir } from "./path-containment.ts";
import type { SystemSkillContribution } from "./system-skills.ts";
import { computeTreeSha256V1 } from "./tree-digest.ts";

/**
 * System-skill library content publication (design v8 §8 / §9 discipline):
 * no-replace first publish; version refresh via temp swap; retired snapshots
 * are only removed when they digest to a tree Pier itself published —
 * anything else is quarantined, never destroyed. Split from
 * system-skills.ts (file-size cap).
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

/** Copy the immutable content dir into the project library (no-replace or
 * version refresh). Refresh swaps via temp + rename of a fresh copy; the
 * retired snapshot is only removed after the swap succeeded. */
export async function publishSystemSkillContent(args: {
  projectRoot: string;
  contribution: SystemSkillContribution;
  /** Digests Pier itself published for this skill. */
  publishedDigests: ReadonlySet<string>;
}): Promise<string> {
  const { projectRoot, contribution } = args;
  const sourceDigest = await computeTreeSha256V1(contribution.contentDir);
  const libraryDir = join(
    projectRoot,
    ".pier",
    "skills",
    "library",
    contribution.id
  );
  const current = await libraryDigest(projectRoot, contribution.id);
  if (current === sourceDigest) {
    return sourceDigest;
  }
  const tempDir = join(
    dirname(libraryDir),
    `.pier-system-skill-${process.pid}-${randomUUID()}.tmp`
  );
  await ensureProjectRelativeDir(projectRoot, ".pier/skills/library");
  await copyTree(contribution.contentDir, tempDir);
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
    // Never destroy content Pier cannot vouch for (design §9: no blind
    // recursive deletes). The retired snapshot is only removed when it
    // digests to a tree Pier itself published;
    // anything else — external edits, unknown files, undigestable
    // entries — is preserved in a quarantine directory for inspection.
    let graveDigest: string | null = null;
    try {
      graveDigest = await computeTreeSha256V1(grave);
    } catch {
      graveDigest = null;
    }
    if (graveDigest !== null && args.publishedDigests.has(graveDigest)) {
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
