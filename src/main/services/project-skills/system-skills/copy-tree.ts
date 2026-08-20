import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Copy a skill tree; reject symlinks and special files (system-skill source). */
export async function copySystemSkillTree(
  sourceDir: string,
  destDir: string
): Promise<void> {
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
      await copySystemSkillTree(src, dst);
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
