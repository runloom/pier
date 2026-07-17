import {
  type Extension,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  GutterMarker,
  gutterLineClass,
} from "@codemirror/view";
import { EditorView } from "codemirror";
import type {
  GitGutterKind,
  GitGutterLineMarker,
} from "./files-editor-git-markers.ts";

const setGitGutterMarkersEffect = StateEffect.define<{
  gutter: RangeSet<GutterMarker>;
  lines: DecorationSet;
}>();

/**
 * 官方做法：gutterLineClass facet 给「该行所有 gutter 元素」加 elementClass
 * （行号列 + fold 列一并上色），只用 elementClass、不写 toDOM，避免 marker
 * 出现在所有 gutter 里当内容。content 行用 Decoration.line 同色铺底，
 * 与 gutter 无缝连贯（CM 官方 gutterLineClass + styling 无 border 做法）。
 *
 * @see https://codemirror.net/examples/gutter/
 * @see https://codemirror.net/docs/ref/#view.gutterLineClass
 */
class GitGutterMarkerImpl extends GutterMarker {
  readonly kind: GitGutterKind;
  readonly count: number;
  override readonly elementClass: string;
  constructor(kind: GitGutterKind, count: number) {
    super();
    this.kind = kind;
    this.count = count;
    this.elementClass = `cm-gitRow-${kind}`;
  }
  override eq(other: GitGutterMarkerImpl): boolean {
    return this.kind === other.kind && this.count === other.count;
  }
}

function markerFor(marker: GitGutterLineMarker): GitGutterMarkerImpl {
  return new GitGutterMarkerImpl(marker.kind, marker.count);
}

const gitGutterField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setGitGutterMarkersEffect)) {
        return e.value.gutter;
      }
    }
    return value;
  },
  // 官方：gutterLineClass 把 class 加到该行所有 gutter 元素（行号+fold）。
  provide: (field) => gutterLineClass.from(field),
});

const gitLineBgField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setGitGutterMarkersEffect)) {
        return e.value.lines;
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function buildMarkers(
  markers: ReadonlyMap<number, GitGutterLineMarker>,
  doc: { line: (n: number) => { from: number } }
): { gutter: RangeSet<GutterMarker>; lines: DecorationSet } {
  const sorted = [...markers.entries()].sort((a, b) => a[0] - b[0]);
  const gutterBuilder = new RangeSetBuilder<GutterMarker>();
  const lineDecos: ReturnType<typeof Decoration.line>[] = [];
  const lineRanges: Array<{ from: number; to: number }> = [];
  for (const [line, marker] of sorted) {
    const lineObj = doc.line(line);
    gutterBuilder.add(lineObj.from, lineObj.from, markerFor(marker));
    // 行背景仅 added/modified（deleted 无文档行可铺底）
    if (marker.kind !== "deleted") {
      lineDecos.push(Decoration.line({ class: `cm-gitLine-${marker.kind}` }));
      lineRanges.push({ from: lineObj.from, to: lineObj.from });
    }
  }
  const lineBgBuilder = new RangeSetBuilder<Decoration>();
  for (let i = 0; i < lineDecos.length; i += 1) {
    const deco = lineDecos[i];
    const r = lineRanges[i];
    if (!(deco && r)) {
      continue;
    }
    lineBgBuilder.add(r.from, r.to, deco);
  }
  return { gutter: gutterBuilder.finish(), lines: lineBgBuilder.finish() };
}

export function setGitGutterMarkers(
  view: EditorView,
  markers: ReadonlyMap<number, GitGutterLineMarker>
): void {
  const built = buildMarkers(markers, view.state.doc);
  view.dispatch({
    effects: setGitGutterMarkersEffect.of(built),
  });
}

export function clearGitGutterMarkers(view: EditorView): void {
  view.dispatch({
    effects: setGitGutterMarkersEffect.of({
      gutter: RangeSet.empty,
      lines: Decoration.none,
    }),
  });
}

export function createGitGutterExtension(): Extension {
  return [gitGutterField, gitLineBgField];
}
