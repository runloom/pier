import {
  type Extension,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { GutterMarker, gutterLineClass } from "@codemirror/view";
import type { EditorView } from "codemirror";
import type { GitGutterKind, GitGutterLineMarker } from "./git-markers.ts";

const setGitGutterMarkersEffect = StateEffect.define<RangeSet<GutterMarker>>();

/**
 * Files 插件 git 状态：仅最左 gutter 边条，不铺行背景 / gutter 槽底色。
 * 官方 gutterLineClass 给该行 gutter 元素加 class；主题只在 first-child 画 inset 边条。
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
        return e.value;
      }
    }
    return value;
  },
  provide: (field) => gutterLineClass.from(field),
});

function buildMarkers(
  markers: ReadonlyMap<number, GitGutterLineMarker>,
  doc: { line: (n: number) => { from: number }; lines: number }
): RangeSet<GutterMarker> {
  const sorted = [...markers.entries()].sort((a, b) => a[0] - b[0]);
  const gutterBuilder = new RangeSetBuilder<GutterMarker>();
  for (const [line, marker] of sorted) {
    // 标记基于磁盘 diff 的行号；脏缓冲可能比磁盘短（未保存的删除行）。
    // 越界行直接跳过，避免 doc.line 抛 RangeError 导致整 root gutter 被清空。
    if (line < 1 || line > doc.lines) {
      continue;
    }
    const lineObj = doc.line(line);
    gutterBuilder.add(lineObj.from, lineObj.from, markerFor(marker));
  }
  return gutterBuilder.finish();
}

export function setGitGutterMarkers(
  view: EditorView,
  markers: ReadonlyMap<number, GitGutterLineMarker>
): void {
  view.dispatch({
    effects: setGitGutterMarkersEffect.of(
      buildMarkers(markers, view.state.doc)
    ),
  });
}

export function clearGitGutterMarkers(view: EditorView): void {
  view.dispatch({
    effects: setGitGutterMarkersEffect.of(RangeSet.empty),
  });
}

export function createGitGutterExtension(): Extension {
  return [gitGutterField];
}
