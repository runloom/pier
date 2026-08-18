import { type FileDiffMetadata, processFile } from "@pierre/diffs";

export const IMAGE_DIFF_CACHE_KEY_PREFIX = "image-diff:";

const IMAGE_DIFF_PLACEHOLDER_OID = "1111111111111111111111111111111111111111";
const IMAGE_DIFF_PLACEHOLDER_OID_NEXT =
  "2222222222222222222222222222222222222222";

export function isImageDiffCacheKey(cacheKey: string | undefined): boolean {
  return (
    typeof cacheKey === "string" &&
    cacheKey.startsWith(IMAGE_DIFF_CACHE_KEY_PREFIX)
  );
}

export function imageDiffCacheKey(itemCacheKey: string): string {
  return `${IMAGE_DIFF_CACHE_KEY_PREFIX}${itemCacheKey}`;
}

/**
 * One context line so Pierre has totalLines > 0 (file-level annotations
 * require that). Stats stay 0+0; dummy lines are hidden in CSS.
 */
export function createImageDiffFileDiff(input: {
  readonly cacheKey: string;
  readonly name: string;
  readonly prevName?: string;
  readonly type: FileDiffMetadata["type"];
}): FileDiffMetadata {
  const name = input.name.replaceAll("\n", "");
  const patch = [
    `diff --git a/${name} b/${name}`,
    `index ${IMAGE_DIFF_PLACEHOLDER_OID}..${IMAGE_DIFF_PLACEHOLDER_OID_NEXT} 100644`,
    `--- a/${name}`,
    `+++ b/${name}`,
    "@@ -1 +1 @@",
    " ",
    "",
  ].join("\n");
  const parsed = processFile(patch, {
    cacheKey: imageDiffCacheKey(input.cacheKey),
    isGitDiff: true,
    throwOnError: true,
  });
  if (!parsed) {
    throw new Error(`Pierre did not parse image diff item: ${name}`);
  }
  return {
    ...parsed,
    cacheKey: imageDiffCacheKey(input.cacheKey),
    isPartial: false,
    name: input.name,
    type: input.type,
    ...(input.prevName === undefined ? {} : { prevName: input.prevName }),
  };
}
