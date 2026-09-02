import type { DiffLineAnnotation, FileDiffMetadata } from "@pierre/diffs";
import type { PierConflictFileBody } from "./types.ts";

export interface PierUnresolvedConflictAnnotationMetadata {
  readonly conflict: PierConflictFileBody;
  readonly kind: "unresolved-conflict";
  readonly path: string;
  readonly stateNotice?: string;
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
    readonly stateNotice?: string;
  }
): DiffLineAnnotation<PierUnresolvedConflictAnnotationMetadata>[] {
  const side = fileType === "deleted" ? "deletions" : "additions";
  return [
    {
      lineNumber: 0,
      metadata: {
        conflict: input.conflict,
        kind: "unresolved-conflict",
        path: input.path,
        ...(input.stateNotice === undefined
          ? {}
          : { stateNotice: input.stateNotice }),
      },
      side,
    },
  ];
}
