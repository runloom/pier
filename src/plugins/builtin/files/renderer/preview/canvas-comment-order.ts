/**
 * Shared ordering and identity for canvas comment pins (oldest first).
 */
import { normalizeCanvasPickText } from "./canvas-pick-shared.ts";
import type { CanvasCommentThreadView } from "./use-canvas-preview-comments.ts";

export function sortLiveCanvasCommentThreads(
  threads: readonly CanvasCommentThreadView[]
): CanvasCommentThreadView[] {
  return [...threads].sort((left, right) => {
    if (left.comment.createdAt !== right.comment.createdAt) {
      return left.comment.createdAt - right.comment.createdAt;
    }
    return left.threadId.localeCompare(right.threadId);
  });
}

export function primaryCanvasPinThread(
  threads: readonly CanvasCommentThreadView[]
): CanvasCommentThreadView | undefined {
  return sortLiveCanvasCommentThreads(threads)[0];
}

/** Stable pin identity: declared id, else normalized label. */
export function canvasCommentPinIdentityKey(
  thread: CanvasCommentThreadView
): string | null {
  if (thread.anchorId !== undefined && thread.anchorId.length > 0) {
    return `anchor-${thread.anchorId}`;
  }
  const label = normalizeCanvasPickText(thread.label, 80).toLowerCase();
  if (label.length === 0) {
    return null;
  }
  return `label:${label}`;
}
