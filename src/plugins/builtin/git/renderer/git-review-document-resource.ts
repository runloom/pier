import type {
  GitReviewFailure,
  GitReviewFileDocumentOk,
  GitReviewIndexEntry,
} from "@shared/contracts/git-review.ts";

export type GitReviewDocumentResource =
  | { readonly entry: GitReviewIndexEntry; readonly kind: "idle" }
  | {
      readonly entry: GitReviewIndexEntry;
      readonly kind: "loading";
      readonly operationId: string;
    }
  | {
      readonly entry: GitReviewIndexEntry;
      readonly kind: "cancelling";
      readonly operationId: string;
    }
  | {
      readonly document: GitReviewFileDocumentOk;
      readonly entry: GitReviewIndexEntry;
      readonly kind: "loaded";
    }
  | { readonly entry: GitReviewIndexEntry; readonly kind: "unchanged" }
  | {
      readonly entry: GitReviewIndexEntry;
      readonly failure: GitReviewFailure;
      readonly kind: "error";
    };

export interface GitReviewDocumentLoaderSnapshot {
  readonly resources: readonly GitReviewDocumentResource[];
  /** 已保留正文，按最久未使用到最近使用排序。 */
  readonly retainedEntryKeys: readonly string[];
  readonly settled: boolean;
}

export interface GitReviewDocumentLoaderChange {
  readonly resources: readonly GitReviewDocumentResource[];
  readonly settled: boolean;
}
