import type { EditorView } from "@codemirror/view";

export function restoreFileEditorScroll(
  view: EditorView,
  scroll: { left: number; top: number }
): void {
  const apply = () => {
    view.scrollDOM.scrollLeft = scroll.left;
    view.scrollDOM.scrollTop = scroll.top;
  };
  apply();
  view.requestMeasure({ read: () => undefined, write: apply });
}
