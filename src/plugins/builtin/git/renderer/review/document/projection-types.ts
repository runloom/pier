import type { PierDiffViewItem } from "@pier/ui/diff-view/index.tsx";
import type { GitReviewDocumentLoaderSnapshot } from "./resource.ts";

export interface ReviewDocumentViewState {
  readonly generation: number;
  readonly retainedEntryKeys: readonly string[];
  readonly settled: boolean;
  readonly staleRetainedCount: number;
}

export const EMPTY_DOCUMENT_VIEW_STATE: ReviewDocumentViewState = {
  generation: 0,
  retainedEntryKeys: [],
  settled: false,
  staleRetainedCount: 0,
};

export interface ReviewDocumentProjection {
  readonly entryKeyBySectionId: ReadonlyMap<string, string>;
  readonly items: readonly PierDiffViewItem[];
  /** Section item id → authoritative file revision. */
  readonly revisionBySectionId: ReadonlyMap<string, string>;
  /** 接受这份投影的权威 git index 代数；跨阅读面交接只比较这一时钟。 */
  readonly sourceIndexGeneration: number;
}

export interface ReviewDocumentResourceProjection {
  readonly items: readonly PierDiffViewItem[];
}

export interface ReviewDocumentProjectionIndex {
  readonly itemCacheKeys: ReadonlyMap<string, string>;
  readonly itemIds: readonly string[];
  readonly itemIndexById: ReadonlyMap<string, number>;
}

export interface ReconciledReviewDocumentSnapshot {
  readonly generation: number;
  readonly snapshot: GitReviewDocumentLoaderSnapshot;
  readonly staleRetainedCount: number;
}
