import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { isPathInside } from "../import/fs.ts";

/**
 * Pick the install source for a product skill.
 *
 * `$projectRoot/resources/system-skills/<id>` is Pier dogfood only: the
 * registered `contentDir` must already live inside this project (the running
 * app's resource tree), the vendor dir and SKILL.md must be real (not
 * symlinks), and `realpath` must stay inside the project. Any other opened
 * folder — including one that merely vendors that path — uses `contentDir`.
 * Production callers pass `allowProjectVendorSource: false`.
 */
export async function resolveSystemSkillSourceDir(args: {
  allowProjectVendorSource: boolean;
  fallbackContentDir: string;
  projectRoot: string;
  skillId: string;
}): Promise<string> {
  if (!args.allowProjectVendorSource) {
    return args.fallbackContentDir;
  }

  const projectSource = join(
    args.projectRoot,
    "resources",
    "system-skills",
    args.skillId
  );
  try {
    const dirInfo = await lstat(projectSource);
    if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink()) {
      return args.fallbackContentDir;
    }
    const skillMd = await lstat(join(projectSource, "SKILL.md"));
    if (!skillMd.isFile() || skillMd.isSymbolicLink()) {
      return args.fallbackContentDir;
    }
    const rootReal = await realpath(args.projectRoot);
    const sourceReal = await realpath(projectSource);
    const contentReal = await realpath(args.fallbackContentDir);
    if (
      !(
        isPathInside(rootReal, sourceReal) &&
        isPathInside(rootReal, contentReal)
      )
    ) {
      return args.fallbackContentDir;
    }
    return sourceReal;
  } catch {
    return args.fallbackContentDir;
  }
}
