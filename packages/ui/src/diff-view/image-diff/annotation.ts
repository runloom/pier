import type { DiffLineAnnotation, FileDiffMetadata } from "@pierre/diffs";
import type { PierDiffViewItemImageDiff } from "./types.ts";

export interface PierImageDiffAnnotationMetadata {
  readonly after: PierDiffViewItemImageDiff["after"];
  readonly before: PierDiffViewItemImageDiff["before"];
  readonly kind: "image-diff";
}

export function isImageDiffAnnotation(
  value: unknown
): value is PierImageDiffAnnotationMetadata {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.kind === "image-diff";
}

export function buildImageDiffAnnotation(
  fileType: FileDiffMetadata["type"],
  imageDiff: PierDiffViewItemImageDiff
): DiffLineAnnotation<PierImageDiffAnnotationMetadata>[] {
  const side = fileType === "deleted" ? "deletions" : "additions";
  return [
    {
      lineNumber: 0,
      metadata: {
        after: imageDiff.after,
        before: imageDiff.before,
        kind: "image-diff",
      },
      side,
    },
  ];
}
