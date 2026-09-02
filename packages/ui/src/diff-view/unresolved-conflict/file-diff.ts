import { type FileDiffMetadata, processFile } from "@pierre/diffs";

export const UNRESOLVED_CONFLICT_CACHE_KEY_PREFIX = "unresolved-conflict:";

const PLACEHOLDER_OID = "1111111111111111111111111111111111111111";
const PLACEHOLDER_OID_NEXT = "2222222222222222222222222222222222222222";

export function isUnresolvedConflictCacheKey(
  cacheKey: string | undefined
): boolean {
  return (
    typeof cacheKey === "string" &&
    cacheKey.startsWith(UNRESOLVED_CONFLICT_CACHE_KEY_PREFIX)
  );
}

export function unresolvedConflictCacheKey(itemCacheKey: string): string {
  return `${UNRESOLVED_CONFLICT_CACHE_KEY_PREFIX}${itemCacheKey}`;
}

/**
 * One context line so Pierre has totalLines > 0 (file-level annotations
 * require that). Dummy lines are hidden in CSS; UnresolvedFile is the body.
 */
export function createUnresolvedConflictFileDiff(input: {
  readonly cacheKey: string;
  readonly name: string;
  readonly prevName?: string;
  readonly type: FileDiffMetadata["type"];
}): FileDiffMetadata {
  const name = input.name.replaceAll("\n", "");
  const patch = [
    `diff --git a/${name} b/${name}`,
    `index ${PLACEHOLDER_OID}..${PLACEHOLDER_OID_NEXT} 100644`,
    `--- a/${name}`,
    `+++ b/${name}`,
    "@@ -1 +1 @@",
    " ",
    "",
  ].join("\n");
  const parsed = processFile(patch, {
    cacheKey: unresolvedConflictCacheKey(input.cacheKey),
    isGitDiff: true,
    throwOnError: true,
  });
  if (!parsed) {
    throw new Error(`Pierre did not parse conflict item: ${name}`);
  }
  return {
    ...parsed,
    cacheKey: unresolvedConflictCacheKey(input.cacheKey),
    isPartial: false,
    name: input.name,
    type: input.type,
    ...(input.prevName === undefined ? {} : { prevName: input.prevName }),
  };
}
