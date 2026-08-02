import type { EditorView } from "@codemirror/view";
import {
  defaultMarkdownCrossModeAnchor,
  type MarkdownCrossModeAnchor,
  markdownViewportFocusY,
} from "../markdown/cross-mode-anchor.ts";

/**
 * Capture a content anchor for exclusive source → preview mode switch.
 * Prefer caret when it is in the viewport; otherwise map the focus band.
 */
export function captureEditorViewportAnchor(
  view: EditorView
): MarkdownCrossModeAnchor {
  const head = view.state.selection.main.head;
  const scrollDOM = view.scrollDOM;
  const rect = scrollDOM.getBoundingClientRect();
  const caretCoords = view.coordsAtPos(head);
  if (
    caretCoords &&
    caretCoords.bottom > rect.top &&
    caretCoords.top < rect.bottom
  ) {
    return defaultMarkdownCrossModeAnchor(head);
  }
  const focusY = markdownViewportFocusY(rect);
  const midX = rect.left + Math.max(1, rect.width) / 2;
  const focusPos = view.posAtCoords({ x: midX, y: focusY });
  if (focusPos !== null) {
    return defaultMarkdownCrossModeAnchor(focusPos);
  }
  const topPos = view.posAtCoords({ x: midX, y: rect.top + 1 });
  if (topPos !== null) {
    return defaultMarkdownCrossModeAnchor(topPos);
  }
  return defaultMarkdownCrossModeAnchor(head);
}
