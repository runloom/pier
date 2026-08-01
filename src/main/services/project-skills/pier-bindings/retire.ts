import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { skillIdSchema } from "@shared/contracts/project-skills.ts";
import { computeTreeSha256V1 } from "../tree-digest.ts";

/**
 * Remove Pier-published library copies that are no longer desired and are not
 * owned by the project manifest or system-skills channel.
 */
export async function retireUndesiredPierBoundLibraryCopies(args: {
  desiredSkillIds: ReadonlySet<string>;
  manifestSkillIds: ReadonlySet<string>;
  projectRoot: string;
  publishedDigestsBySkill: Map<string, Set<string>>;
  systemSkillIds: ReadonlySet<string>;
}): Promise<string[]> {
  const libraryParent = join(args.projectRoot, ".pier", "skills", "library");
  let entries: string[] = [];
  try {
    entries = await readdir(libraryParent);
  } catch {
    return [];
  }
  const retired: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (!skillIdSchema.safeParse(entry).success) continue;
    if (args.desiredSkillIds.has(entry)) continue;
    if (args.manifestSkillIds.has(entry)) continue;
    if (args.systemSkillIds.has(entry)) continue;
    const known = args.publishedDigestsBySkill.get(entry);
    if (!known || known.size === 0) continue;
    const dir = join(libraryParent, entry);
    let digest: string | null = null;
    try {
      digest = await computeTreeSha256V1(dir);
    } catch {
      digest = null;
    }
    if (digest === null || !known.has(digest)) {
      continue;
    }
    try {
      await rm(dir, { force: true, recursive: true });
      retired.push(entry);
      args.publishedDigestsBySkill.delete(entry);
    } catch {
      // Best-effort retirement.
    }
  }
  return retired;
}
