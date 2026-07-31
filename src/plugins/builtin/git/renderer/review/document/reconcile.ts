import {
  GIT_REVIEW_MAX_RETAINED_BYTES,
  GIT_REVIEW_MAX_RETAINED_LINES,
  gitReviewDocumentMetrics,
  isGitReviewDocumentReservable,
} from "./limits.ts";
import { retainLoadedDocumentForEntry } from "./loader-utils.ts";
import type { ReconciledReviewDocumentSnapshot } from "./projection.ts";
import type {
  GitReviewDocumentLoaderSnapshot,
  GitReviewDocumentResource,
} from "./resource.ts";

function effectiveProtectedPreviousEntryKey(
  previousByEntryKey: ReadonlyMap<
    string,
    Extract<GitReviewDocumentResource, { kind: "loaded" }>
  >,
  protectedEntryKey: string | null
): string | null {
  const protectedResource = protectedEntryKey
    ? previousByEntryKey.get(protectedEntryKey)
    : undefined;
  if (!protectedResource) {
    return null;
  }
  return isGitReviewDocumentReservable(protectedResource.document)
    ? protectedEntryKey
    : null;
}

function oldestUnprotectedPrevious(
  previousByEntryKey: ReadonlyMap<
    string,
    Extract<GitReviewDocumentResource, { kind: "loaded" }>
  >,
  protectedEntryKey: string | null
):
  | readonly [string, Extract<GitReviewDocumentResource, { kind: "loaded" }>]
  | null {
  for (const entry of previousByEntryKey) {
    if (entry[0] !== protectedEntryKey) {
      return entry;
    }
  }
  return null;
}

export function reconcileReviewDocumentSnapshot(
  current: GitReviewDocumentLoaderSnapshot,
  previousByEntryKey: Map<
    string,
    Extract<GitReviewDocumentResource, { kind: "loaded" }>
  >,
  generation: number,
  protectedEntryKey: string | null
): ReconciledReviewDocumentSnapshot {
  let staleRetainedCount = 0;
  for (const resource of current.resources) {
    if (resource.kind === "loaded") {
      previousByEntryKey.delete(resource.entry.entryKey);
    }
  }
  let retainedBytes = 0;
  let retainedLines = 0;
  for (const previous of previousByEntryKey.values()) {
    const metrics = gitReviewDocumentMetrics(previous.document);
    retainedBytes += metrics.bytes;
    retainedLines += metrics.lines;
  }
  for (const resource of current.resources) {
    if (resource.kind === "loaded") {
      const metrics = gitReviewDocumentMetrics(resource.document);
      retainedBytes += metrics.bytes;
      retainedLines += metrics.lines;
    }
  }
  const protectedPreviousEntryKey = effectiveProtectedPreviousEntryKey(
    previousByEntryKey,
    protectedEntryKey
  );
  while (
    retainedBytes > GIT_REVIEW_MAX_RETAINED_BYTES ||
    retainedLines > GIT_REVIEW_MAX_RETAINED_LINES
  ) {
    const oldest = oldestUnprotectedPrevious(
      previousByEntryKey,
      protectedPreviousEntryKey
    );
    if (!oldest) {
      break;
    }
    previousByEntryKey.delete(oldest[0]);
    const metrics = gitReviewDocumentMetrics(oldest[1].document);
    retainedBytes -= metrics.bytes;
    retainedLines -= metrics.lines;
  }
  const resources = current.resources.map((resource) => {
    const previous = previousByEntryKey.get(resource.entry.entryKey);
    if (!previous) {
      return resource;
    }
    if (resource.kind === "unchanged") {
      staleRetainedCount += 1;
    } else if (resource.kind === "loaded") {
      return resource;
    }
    // stage 换 sectionKey 时必须 remap，否则投影按新 slot 找不到 section。
    return (
      retainLoadedDocumentForEntry(resource.entry, previous.document) ??
      resource
    );
  });
  const retainedEntryKeys = [
    ...previousByEntryKey.keys(),
    ...current.retainedEntryKeys,
  ];
  return {
    generation,
    snapshot: { ...current, resources, retainedEntryKeys },
    staleRetainedCount,
  };
}
