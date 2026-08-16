import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
  PierInlineReviewThread,
} from "@pier/ui/diff-view/review/inline-comment-types.ts";

/** Optional block-comment chrome layered on IR render. */
export interface MarkdownIrCommentsChrome {
  readonly addCommentLabel: string;
  /**
   * Draft identity is contentHash (stable across reparse), not IR offsets.
   * Shells compare against the current block's contentHash.
   */
  readonly draftBlockKey: string | null;
  readonly handlers: PierInlineReviewHandlers;
  readonly labels: PierInlineReviewLabels;
  /** All located threads for a block key (multi-thread safe). */
  readonly locatedByBlockKey: ReadonlyMap<
    string,
    { readonly threads: readonly PierInlineReviewThread[] }
  >;
  readonly onOpenDraft: (blockKey: string) => void;
  /**
   * Navigator / reveal asks this block to open its badge popover.
   * Null with a non-zero nonce means close every located popover (drift).
   */
  readonly requestOpenBlockKey: string | null;
  /** Bumps on each reveal so the same block can reopen after dismiss. */
  readonly requestOpenNonce: number;
  readonly viewCommentLabel: string;
  /** Template with `{{count}}` when a block has more than one thread. */
  readonly viewCommentsLabel: string;
}
