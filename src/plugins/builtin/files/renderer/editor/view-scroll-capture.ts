import type { EditorView } from "@codemirror/view";

export interface EditorScrollOffset {
  left: number;
  top: number;
}

/**
 * 面板隐藏（Activity / display:none）时不把 scrollTop=0 写进快照。
 * 不用 offsetParent/clientRects：jsdom 与 sticky gutter 下不可靠。
 */
export function isEditorScrollSurfaceVisible(view: EditorView): boolean {
  const el = view.scrollDOM;
  if (!el.isConnected) {
    return false;
  }
  const win = el.ownerDocument.defaultView;
  if (!win) {
    return true;
  }
  let node: HTMLElement | null = el;
  while (node) {
    const style = win.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    node = node.parentElement;
  }
  return true;
}

/**
 * 从 live view 更新滚动快照。隐藏后 DOM 常把 scroll 归零时保留上次非零位置。
 */
export function captureEditorScrollOffset(
  view: EditorView,
  previous: EditorScrollOffset
): EditorScrollOffset {
  const left = view.scrollDOM.scrollLeft;
  const top = view.scrollDOM.scrollTop;
  if (
    left === 0 &&
    top === 0 &&
    (previous.left !== 0 || previous.top !== 0) &&
    !isEditorScrollSurfaceVisible(view)
  ) {
    return previous;
  }
  return { left, top };
}

/** 绑定 scroll 监听；返回 unbind。不可见时不写入（避免 hide 时 0 覆盖）。 */
export function bindEditorScrollCapture(
  view: EditorView,
  onScroll: (offset: EditorScrollOffset) => void
): () => void {
  const handler = (): void => {
    if (!isEditorScrollSurfaceVisible(view)) {
      return;
    }
    onScroll({
      left: view.scrollDOM.scrollLeft,
      top: view.scrollDOM.scrollTop,
    });
  };
  view.scrollDOM.addEventListener("scroll", handler, { passive: true });
  return () => {
    view.scrollDOM.removeEventListener("scroll", handler);
  };
}
