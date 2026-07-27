/**
 * Resolve content-search scopeDir under project root (symlink-safe).
 */
import { realpath, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { ContentSearchError } from "./content-search-error.ts";

export async function resolveSearchRoot(
  root: string,
  scopeDir: string | undefined
): Promise<string> {
  let rootReal: string;
  try {
    rootReal = await realpath(root);
  } catch (error) {
    throw new ContentSearchError(
      "content-search-failed",
      error instanceof Error ? error.message : String(error)
    );
  }

  if (!scopeDir) return rootReal;

  const joined = resolve(rootReal, scopeDir);
  const lexicalRel = relative(rootReal, joined);
  if (
    lexicalRel.startsWith("..") ||
    lexicalRel.includes(`..${sep}`) ||
    lexicalRel === ".."
  ) {
    throw new ContentSearchError(
      "invalid-scope",
      `scopeDir escapes project root: ${scopeDir}`
    );
  }
  try {
    const scopeReal = await realpath(joined);
    const realRel = relative(rootReal, scopeReal);
    if (realRel === "") {
      return rootReal;
    }
    if (
      realRel.startsWith("..") ||
      realRel.includes(`..${sep}`) ||
      realRel === ".." ||
      realRel.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(realRel)
    ) {
      throw new ContentSearchError(
        "invalid-scope",
        `scopeDir escapes project root: ${scopeDir}`
      );
    }
    const st = await stat(scopeReal);
    if (!st.isDirectory()) {
      throw new ContentSearchError(
        "invalid-scope",
        `scopeDir is not a directory: ${scopeDir}`
      );
    }
    return scopeReal;
  } catch (error) {
    if (error instanceof ContentSearchError) throw error;
    throw new ContentSearchError(
      "invalid-scope",
      `scopeDir is not accessible: ${scopeDir}`
    );
  }
}
