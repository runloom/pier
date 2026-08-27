import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewExcerptBatchResult,
  GitReviewFileDocumentResult,
  GitReviewIndexEntry,
  GitReviewScope,
} from "@shared/contracts/git/review.ts";
import type { GitReviewDocumentResource } from "./resource.ts";

type LoadedByKey = ReadonlyMap<
  string,
  Extract<GitReviewDocumentResource, { kind: "loaded" }>
>;

export function loadReviewFileDocument(
  context: RendererPluginContext,
  scope: GitReviewScope,
  previousByEntryKey: LoadedByKey,
  entry: GitReviewIndexEntry,
  operationId: string
): Promise<GitReviewFileDocumentResult> {
  const previousRevision = previousByEntryKey.get(entry.entryKey)?.document
    .revision;
  return context.git.getReviewFileDocument({
    operationId,
    ...(previousRevision === undefined ? {} : { previousRevision }),
    source: {
      ...scope,
      oldPaths: entry.oldPaths,
      path: entry.path,
    },
  });
}

export function loadReviewExcerptBatch(
  context: RendererPluginContext,
  scope: GitReviewScope,
  previousByEntryKey: LoadedByKey,
  entries: readonly GitReviewIndexEntry[],
  operationId: string
): Promise<GitReviewExcerptBatchResult> {
  return context.git.getReviewExcerptBatch({
    files: entries.map((entry) => {
      const previousRevision = previousByEntryKey.get(entry.entryKey)?.document
        .revision;
      return {
        oldPaths: [...entry.oldPaths],
        path: entry.path,
        ...(previousRevision === undefined ? {} : { previousRevision }),
      };
    }),
    operationId,
    source: scope,
  });
}
