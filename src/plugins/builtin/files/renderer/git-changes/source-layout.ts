import type { EditorView } from "@codemirror/view";
import { filesEditorEndInset } from "../editor/layout.ts";

export function sourcePeekGeometry(input: {
  viewportLeft: number;
  viewportRight: number;
  contentLeft: number;
  paddingLeft: number;
  gutterRight: number;
  minimapLeft: number | null;
  endInset: number;
  scaleX?: number;
}): { left: number; width: number } {
  const scale = input.scaleX ?? 1;
  const left = Math.max(
    input.contentLeft + input.paddingLeft * scale,
    input.gutterRight + input.paddingLeft * scale,
    input.viewportLeft
  );
  const right = Math.min(
    input.viewportRight,
    input.minimapLeft ?? input.viewportRight
  );
  return {
    left: (left - input.viewportLeft) / scale,
    width: Math.max(0, (right - left) / scale - input.endInset),
  };
}

/** Keep the inline tool inside the visible code column, even on horizontal scroll. */
export function trackSourcePeekLayout(
  view: EditorView,
  host: HTMLElement
): () => void {
  let active = true;
  const read = () => {
    if (!active) return null;
    const scroll = view.scrollDOM.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    const gutter = view.scrollDOM.querySelector<HTMLElement>(
      ":scope > .cm-gutters:not(.cm-minimap-gutter)"
    );
    const minimap = view.scrollDOM.querySelector<HTMLElement>(
      ":scope > .cm-minimap-gutter"
    );
    const style = getComputedStyle(view.contentDOM);
    return sourcePeekGeometry({
      viewportLeft: scroll.left,
      viewportRight:
        scroll.left +
        (view.scrollDOM.clientWidth * view.scaleX || scroll.width),
      contentLeft: content.left,
      paddingLeft: Number.parseFloat(style.paddingLeft) || 0,
      gutterRight: gutter?.getBoundingClientRect().right ?? scroll.left,
      minimapLeft: minimap?.getBoundingClientRect().left ?? null,
      scaleX: view.scaleX,
      endInset:
        Number.parseFloat(style.getPropertyValue("--files-editor-end-inset")) ||
        filesEditorEndInset(scroll.width),
    });
  };
  const write = (bounds: ReturnType<typeof read>) => {
    if (!(active && bounds)) return;
    const left = `${bounds.left}px`;
    const width = `${bounds.width}px`;
    if (host.style.left !== left) host.style.left = left;
    if (host.style.width !== width) host.style.width = width;
  };
  host.style.position = "sticky";
  host.style.boxSizing = "border-box";
  write(read());
  const schedule = () => {
    if (active) view.requestMeasure({ key: host, read, write });
  };
  const resize = new ResizeObserver(schedule);
  resize.observe(view.scrollDOM);
  resize.observe(view.contentDOM);
  resize.observe(host);
  const observeGutters = () => {
    for (const gutter of view.scrollDOM.querySelectorAll(
      ":scope > .cm-gutters"
    ))
      resize.observe(gutter);
    schedule();
  };
  // Minimap can be toggled without changing the document or the scroll viewport.
  const children = new MutationObserver(observeGutters);
  children.observe(view.scrollDOM, { childList: true });
  observeGutters();
  view.scrollDOM.addEventListener("scroll", schedule, { passive: true });
  view.dom.ownerDocument.fonts?.addEventListener("loadingdone", schedule);
  return () => {
    active = false;
    resize.disconnect();
    children.disconnect();
    view.scrollDOM.removeEventListener("scroll", schedule);
    view.dom.ownerDocument.fonts?.removeEventListener("loadingdone", schedule);
  };
}
