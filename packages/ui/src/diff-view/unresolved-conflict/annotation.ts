import type { DiffLineAnnotation, FileDiffMetadata } from "@pierre/diffs";
import type { PierConflictFileBody } from "./types.ts";

export interface PierUnresolvedConflictAnnotationMetadata {
  readonly conflict: PierConflictFileBody;
  readonly kind: "unresolved-conflict";
  readonly path: string;
}

export function isUnresolvedConflictAnnotation(
  value: unknown
): value is PierUnresolvedConflictAnnotationMetadata {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.kind === "unresolved-conflict";
}

export function buildUnresolvedConflictAnnotation(
  fileType: FileDiffMetadata["type"],
  input: {
    readonly conflict: PierConflictFileBody;
    readonly path: string;
  }
): DiffLineAnnotation<PierUnresolvedConflictAnnotationMetadata>[] | undefined {
  if (
    input.conflict.contents === null ||
    (input.conflict.presentation !== "markers-text" &&
      input.conflict.presentation !== "file-level")
  ) {
    return;
  }
  const side = fileType === "deleted" ? "deletions" : "additions";
  return [
    {
      lineNumber: 0,
      metadata: {
        conflict: input.conflict,
        kind: "unresolved-conflict",
        path: input.path,
      },
      side,
    },
  ];
}
