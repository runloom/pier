import { StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { trackSourcePeekLayout } from "./source-layout.ts";

export const setFileChangePeek = StateEffect.define<{
  at: number;
  host: HTMLElement;
  height?: number;
} | null>();
class FileChangePeekWidget extends WidgetType {
  readonly host: HTMLElement;
  readonly height: number;
  constructor(host: HTMLElement, height = 220) {
    super();
    this.host = host;
    this.height = height;
  }
  override eq(other: FileChangePeekWidget): boolean {
    return this.host === other.host && this.height === other.height;
  }
  override toDOM(): HTMLElement {
    return this.host;
  }
  override ignoreEvent(): boolean {
    return true;
  }
  override updateDOM(dom: HTMLElement): boolean {
    return dom === this.host;
  }
  override get estimatedHeight(): number {
    return this.height;
  }
}
export const fileChangePeekField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = tr.docChanged ? Decoration.none : value;
    for (const effect of tr.effects) {
      if (effect.is(setFileChangePeek)) {
        next = effect.value
          ? Decoration.set([
              Decoration.widget({
                widget: new FileChangePeekWidget(
                  effect.value.host,
                  effect.value.height
                ),
                block: true,
                side: 1,
              }).range(effect.value.at),
            ])
          : Decoration.none;
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Direct StateField decorations are required for block widgets. */
export function mountFileChangePeek(
  view: EditorView,
  line: number,
  host: HTMLElement
): () => void {
  const at = view.state.doc.line(
    Math.max(1, Math.min(view.state.doc.lines, line))
  ).to;
  const top = view.scrollDOM.scrollTop;
  const stopLayout = trackSourcePeekLayout(view, host);
  view.dispatch({ effects: setFileChangePeek.of({ at, host }) });
  view.scrollDOM.scrollTop = top;
  let frame = 0;
  let height = 0;
  const resize = new ResizeObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!host.isConnected) return;
      const next = host.getBoundingClientRect().height / view.scaleY;
      if (next === height) return;
      height = next;
      // .cm-content has a minimum viewport height. requestMeasure alone can
      // retain stale line heights when the widget shrinks inside that minimum.
      // A height-aware decoration refreshes CM's height map while retaining DOM.
      view.dispatch({ effects: setFileChangePeek.of({ at, host, height }) });
    });
  });
  resize.observe(host);
  return () => {
    resize.disconnect();
    cancelAnimationFrame(frame);
    stopLayout();
    if (view.dom.isConnected)
      view.dispatch({ effects: setFileChangePeek.of(null) });
  };
}
