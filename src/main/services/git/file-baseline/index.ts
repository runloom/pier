import type {
  GitFileBaselineInput,
  GitFileBaselineResult,
} from "../../../../shared/contracts/git/file-baseline.ts";
import { type ExecGitRaw, execGitRaw } from "../exec.ts";
import { type BaselineContents, readBaselineBlob } from "./blob.ts";
import {
  type BaselineEnvironment,
  resolveBaselineIdentity,
} from "./identity.ts";

const CACHE_MAX_ENTRIES = 64;
// Account for JS UTF-16 string storage, not just UTF-8 bytes on disk.
const CACHE_MAX_BYTES = 32 * 1024 * 1024;

/** A bounded HEAD-content cache owned by the existing GitService instance. */
export function createGitFileBaselineReader(options: {
  execGitRaw?: ExecGitRaw;
  resolveEnvironment?: (cwd: string) => Promise<BaselineEnvironment>;
}): (input: GitFileBaselineInput) => Promise<GitFileBaselineResult> {
  const exec = options.execGitRaw ?? execGitRaw;
  const cache = new Map<string, BaselineContents>();
  let cacheBytes = 0;

  function remember(key: string, value: BaselineContents): void {
    const previous = cache.get(key);
    if (previous) cacheBytes -= previous.contents.length * 2;
    cache.delete(key);
    cache.set(key, value);
    cacheBytes += value.contents.length * 2;
    while (cache.size > CACHE_MAX_ENTRIES || cacheBytes > CACHE_MAX_BYTES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cacheBytes -= (cache.get(oldest)?.contents.length ?? 0) * 2;
      cache.delete(oldest);
    }
  }

  return async (input) => {
    try {
      const env = (await options.resolveEnvironment?.(input.root)) ?? {};
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const identity = await resolveBaselineIdentity(exec, input, env);
        if ("status" in identity) return identity;
        const key = JSON.stringify([
          identity.gitRoot,
          identity.headOid,
          identity.basePath,
        ]);
        const content =
          cache.get(key) ?? (await readBaselineBlob(exec, identity, env));
        const after = await resolveBaselineIdentity(exec, input, env);
        if ("status" in after) return after;
        if (
          identity.gitRoot !== after.gitRoot ||
          identity.path !== after.path ||
          identity.basePath !== after.basePath ||
          identity.headOid !== after.headOid
        )
          continue;
        if ("status" in content) return content;
        remember(key, content);
        return { status: "ready", ...identity, ...content };
      }
      return {
        status: "error",
        message: "Git HEAD or file identity changed while reading the baseline",
      };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
