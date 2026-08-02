import { EditorView } from "@codemirror/view";
import { MARKDOWN_VIEWPORT_FOCUS_BAND } from "../markdown/cross-mode-anchor.ts";

/**
 * Generation counter so a later content reveal can invalidate an in-flight
 * pixel scroll restore (mount schedules requestMeasure write that would
 * otherwise clobber preview → source content anchors).
 */
const scrollIntentByView = new WeakMap<EditorView, number>();

function nextScrollIntent(view: EditorView): number {
  const next = (scrollIntentByView.get(view) ?? 0) + 1;
  scrollIntentByView.set(view, next);
  return next;
}

function isCurrentScrollIntent(view: EditorView, intent: number): boolean {
  return scrollIntentByView.get(view) === intent;
}

export function restoreFileEditorScroll(
  view: EditorView,
  scroll: { left: number; top: number }
): void {
  const intent = nextScrollIntent(view);
  const left = scroll.left;
  const top = scroll.top;
  const apply = () => {
    if (!isCurrentScrollIntent(view, intent)) {
      return;
    }
    view.scrollDOM.scrollLeft = left;
    view.scrollDOM.scrollTop = top;
  };
  apply();
  view.requestMeasure({ read: () => undefined, write: apply });
}

/**
 * Content-first vertical reveal for exclusive mode switch / go-to.
 *
 * Horizontal policy (product): default to the left edge. Cross-mode does not
 * preserve scrollLeft — preview and source do not share an X coordinate.
 * After resetting left, `x: "nearest"` only nudges if the caret would still be
 * off-screen on a long line.
 */
export function revealFileEditorOffset(
  view: EditorView,
  offset: number,
  options?: {
    head?: number;
    /** When true (default), force scrollLeft=0 before vertical reveal. */
    resetHorizontal?: boolean;
    y?: "center" | "end" | "nearest" | "start";
  }
): void {
  const intent = nextScrollIntent(view);
  const docLength = view.state.doc.length;
  const anchor = Math.max(0, Math.min(offset, docLength));
  const head = Math.max(0, Math.min(options?.head ?? offset, docLength));
  const y = options?.y ?? "start";
  const resetHorizontal = options?.resetHorizontal !== false;
  const yMargin =
    y === "start"
      ? Math.min(
          MARKDOWN_VIEWPORT_FOCUS_BAND.maxPx,
          view.scrollDOM.clientHeight * MARKDOWN_VIEWPORT_FOCUS_BAND.ratio
        )
      : 0;
  const apply = () => {
    if (!isCurrentScrollIntent(view, intent)) {
      return;
    }
    if (resetHorizontal) {
      view.scrollDOM.scrollLeft = 0;
    }
    view.dispatch({
      effects: EditorView.scrollIntoView(anchor, {
        x: "nearest",
        y,
        yMargin,
      }),
      selection: { anchor, head },
    });
  };
  apply();
  // Remount pixel restore also uses requestMeasure write — run after so
  // content anchor is the final scroll owner for this attach cycle.
  view.requestMeasure({ read: () => undefined, write: apply });
}
