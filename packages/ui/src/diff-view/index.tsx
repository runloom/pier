export {
  diffMetrics,
  slotVirtualHeight,
  totalScrollHeight,
} from "./geometry.ts";
export type {
  PierDriftCommentLabels,
  PierGutterReviewEvent,
} from "./gutter/gutter-comments.tsx";
export type {
  PierDiffViewAnchor,
  PierDiffViewHandle,
  PierDiffViewLineSelection,
  PierDiffViewPointerLineHit,
  PierDiffViewUpdateOptions,
} from "./handle-types.ts";
export type {
  PierHunkActionEvent,
  PierHunkAnnotationMetadata,
} from "./hunk-actions.tsx";
export type {
  PierDiffViewImageDiff,
  PierDiffViewItemImageDiff,
  PierImageDiffLabels,
  PierImageDiffLocator,
  PierImageDiffMode,
  PierImageDiffSide,
} from "./image-diff/types.ts";
export type {
  PierDiffReviewCommentThread,
  PierDiffReviewDriftThread,
  PierDiffViewChangeControl,
  PierDiffViewFileDisplay,
  PierDiffViewItem,
  PierDiffViewStageControl,
} from "./items.ts";
export type { PierDiffViewRenderWindow } from "./render-window.ts";
export type { PierActiveReviewSlot } from "./review/annotation-anchors.ts";
export type {
  PierDiffAnnotationMetadata,
  PierDiffReviewAnnotationMetadata,
  PierReviewDraftAnnotationMetadata,
  PierReviewThreadAnnotationMetadata,
} from "./review/annotation-types.ts";
export type {
  PierInlineReviewComment,
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
  PierInlineReviewThread,
} from "./review/inline-comment-types.ts";
export { InlineReviewThreadCard } from "./review/inline-thread-card.tsx";
export {
  fullSelectionRangeForCodeViewItem,
  selectedLinesTextFromCodeViewItem,
} from "./selection-text.ts";
export type {
  PierDiffViewAppearance,
  PierDiffViewLabels,
  PierDiffViewPresentation,
  PierDiffViewProps,
} from "./types.ts";
export {
  type PierConflictFileBody,
  type PierConflictPresentation,
  type PierConflictXy,
  type PierUnresolvedConflictLabels,
  type PierUnresolvedConflictProps,
  PierUnresolvedConflictView,
} from "./unresolved-conflict/index.tsx";
export { PierDiffView } from "./view/pier-diff-view.tsx";
export { PierDiffWorkerProvider } from "./worker.tsx";
