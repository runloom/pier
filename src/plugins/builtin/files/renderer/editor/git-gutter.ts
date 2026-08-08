import {
  type Extension,
  Facet,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { GutterMarker, gutter } from "@codemirror/view";
import type { EditorView } from "codemirror";
import type {
  GitGutterChangeRange,
  GitGutterKind,
  GitGutterLineMarker,
  GitGutterModel,
} from "./git-markers.ts";
import { EMPTY_GIT_GUTTER_MODEL, resolveRangeAtLine } from "./git-markers.ts";

/**
 * Files 插件 SCM 装饰：行号右侧可点 git gutter + minimap 色轨。
 * 点击色条 → 打开/聚焦 Git Changes 并 pendingReveal 到该行（无编辑器内 peek）。
 * 扩展顺序须在 basicSetup（lineNumbers）之后，色条才落在行号右侧。
 *
 * @see https://codemirror.net/examples/gutter/
 */

export interface ScmDiffColors {
  readonly added: string;
  readonly deleted: string;
  readonly modified: string;
}

export interface GitGutterState {
  readonly gutterMarkers: RangeSet<GutterMarker>;
  /** 语义真源：磁盘 diff 行号 → kind/count。 */
  readonly markers: ReadonlyMap<number, GitGutterLineMarker>;
  /** minimap 单轨：行号 → 已解析 CSS 色。空对象 = 无点。 */
  readonly minimapGutter: Readonly<Record<number, string>>;
  readonly ranges: readonly GitGutterChangeRange[];
}

/** 点击 gutter 时导航到 review（由 session / controller 注入）。 */
export type GitGutterNavigateHandler = (lineNumber: number) => void;

export const gitGutterNavigateFacet = Facet.define<
  GitGutterNavigateHandler | null,
  GitGutterNavigateHandler | null
>({
  combine: (values) => values.at(-1) ?? null,
});

const DIFF_COLOR_VARS: Record<GitGutterKind, string> = {
  added: "--diff-addition-fg",
  deleted: "--diff-deletion-fg",
  modified: "--diff-modification-fg",
};

export const EMPTY_GIT_GUTTER_STATE: GitGutterState = {
  gutterMarkers: RangeSet.empty,
  markers: EMPTY_GIT_GUTTER_MODEL.markers,
  ranges: EMPTY_GIT_GUTTER_MODEL.ranges,
  minimapGutter: {},
};

const setGitGutterStateEffect = StateEffect.define<GitGutterState>();

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

/**
 * 从 DOM 计算样式解析产品 diff token。canvas minimap 不能使用 var()。
 * 某 kind 解析为空串时该 kind 不画（调用方跳过），禁止业务硬编码 hex fallback。
 */
export function resolveScmDiffColors(scope: Element): ScmDiffColors {
  const style = getComputedStyle(scope);
  return {
    added: style.getPropertyValue(DIFF_COLOR_VARS.added).trim(),
    deleted: style.getPropertyValue(DIFF_COLOR_VARS.deleted).trim(),
    modified: style.getPropertyValue(DIFF_COLOR_VARS.modified).trim(),
  };
}

/**
 * markers → minimap gutters 色表。越界行可经 maxLine 过滤；无色 token 跳过。
 */
export function markersToMinimapGutter(
  markers: ReadonlyMap<number, GitGutterLineMarker>,
  colors: ScmDiffColors,
  options?: { readonly maxLine?: number }
): Record<number, string> {
  const out: Record<number, string> = {};
  const maxLine = options?.maxLine;
  for (const [line, marker] of markers) {
    if (line < 1 || (maxLine !== undefined && line > maxLine)) {
      continue;
    }
    const color = colors[marker.kind];
    if (!color) {
      continue;
    }
    out[line] = color;
  }
  return out;
}

function buildGutterMarkers(
  markers: ReadonlyMap<number, GitGutterLineMarker>,
  doc: { line: (n: number) => { from: number }; lines: number }
): RangeSet<GutterMarker> {
  const sorted = [...markers.entries()].sort((a, b) => a[0] - b[0]);
  const gutterBuilder = new RangeSetBuilder<GutterMarker>();
  for (const [line, marker] of sorted) {
    if (line < 1 || line > doc.lines) {
      continue;
    }
    const lineObj = doc.line(line);
    gutterBuilder.add(lineObj.from, lineObj.from, markerFor(marker));
  }
  return gutterBuilder.finish();
}

function buildGitGutterState(
  model: GitGutterModel,
  doc: { line: (n: number) => { from: number }; lines: number },
  colors: ScmDiffColors
): GitGutterState {
  return {
    gutterMarkers: buildGutterMarkers(model.markers, doc),
    markers: model.markers,
    ranges: model.ranges,
    minimapGutter: markersToMinimapGutter(model.markers, colors, {
      maxLine: doc.lines,
    }),
  };
}

function minimapGutterEqual(
  a: Readonly<Record<number, string>>,
  b: Readonly<Record<number, string>>
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    const line = Number(key);
    if (a[line] !== b[line]) {
      return false;
    }
  }
  return true;
}

function markersContentEqual(
  a: ReadonlyMap<number, GitGutterLineMarker>,
  b: ReadonlyMap<number, GitGutterLineMarker>
): boolean {
  if (a === b) {
    return true;
  }
  if (a.size !== b.size) {
    return false;
  }
  for (const [line, marker] of a) {
    const other = b.get(line);
    if (!other || other.kind !== marker.kind || other.count !== marker.count) {
      return false;
    }
  }
  return true;
}

function rangesContentEqual(
  a: readonly GitGutterChangeRange[],
  b: readonly GitGutterChangeRange[]
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (
      !(x && y) ||
      x.id !== y.id ||
      x.kind !== y.kind ||
      x.newLineFrom !== y.newLineFrom ||
      x.newLineTo !== y.newLineTo
    ) {
      return false;
    }
  }
  return true;
}

function gitGutterStateEqual(a: GitGutterState, b: GitGutterState): boolean {
  return (
    markersContentEqual(a.markers, b.markers) &&
    rangesContentEqual(a.ranges, b.ranges) &&
    minimapGutterEqual(a.minimapGutter, b.minimapGutter) &&
    RangeSet.eq([a.gutterMarkers], [b.gutterMarkers])
  );
}

/** SCM 装饰 field：gutter + minimap。 */
export const gitGutterField = StateField.define<GitGutterState>({
  create: () => EMPTY_GIT_GUTTER_STATE,
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) {
      if (e.is(setGitGutterStateEffect)) {
        next = e.value;
      }
    }
    if (tr.docChanged && next.markers.size > 0) {
      const rebuilt = buildGutterMarkers(next.markers, tr.state.doc);
      if (!RangeSet.eq([next.gutterMarkers], [rebuilt])) {
        next = { ...next, gutterMarkers: rebuilt };
      }
    }
    return next;
  },
});

function colorScope(view: EditorView): Element {
  return view.dom.isConnected ? view.dom : document.documentElement;
}

function modelFromMarkers(
  markers: ReadonlyMap<number, GitGutterLineMarker>,
  ranges: readonly GitGutterChangeRange[] = []
): GitGutterModel {
  return { markers, ranges };
}

/** 写入完整 model（markers + ranges）。 */
export function setGitGutterModel(
  view: EditorView,
  model: GitGutterModel
): void {
  const next = buildGitGutterState(
    model,
    view.state.doc,
    resolveScmDiffColors(colorScope(view))
  );
  const prev = view.state.field(gitGutterField);
  if (gitGutterStateEqual(prev, next)) {
    return;
  }
  view.dispatch({
    effects: setGitGutterStateEffect.of(next),
  });
}

/** 兼容测试与仅 markers 调用：ranges 置空。 */
export function setGitGutterMarkers(
  view: EditorView,
  markers: ReadonlyMap<number, GitGutterLineMarker>
): void {
  setGitGutterModel(view, modelFromMarkers(markers, []));
}

export function clearGitGutterMarkers(view: EditorView): void {
  const prev = view.state.field(gitGutterField);
  if (
    prev.markers.size === 0 &&
    prev.ranges.length === 0 &&
    Object.keys(prev.minimapGutter).length === 0
  ) {
    return;
  }
  view.dispatch({
    effects: setGitGutterStateEffect.of(EMPTY_GIT_GUTTER_STATE),
  });
}

/**
 * 主题切换时重解析 --diff-*-fg（保留 ranges）。
 * 供 theme-resync 插件调用；不重拉 git。
 */
export function resyncGitGutterColors(view: EditorView): void {
  const current = view.state.field(gitGutterField);
  if (current.markers.size === 0) {
    return;
  }
  const next = buildGitGutterState(
    {
      markers: current.markers,
      ranges: current.ranges,
    },
    view.state.doc,
    resolveScmDiffColors(colorScope(view))
  );
  if (gitGutterStateEqual(current, next)) {
    return;
  }
  view.dispatch({
    effects: setGitGutterStateEffect.of(next),
  });
}

function createGitGutterTrack(): Extension {
  return gutter({
    class: "cm-git-gutter",
    markers: (view) => view.state.field(gitGutterField).gutterMarkers,
    initialSpacer: () => new GitGutterMarkerImpl("added", 1),
    domEventHandlers: {
      mousedown(view, line, event) {
        if (!(event instanceof MouseEvent) || event.button !== 0) {
          return false;
        }
        const lineNumber = view.state.doc.lineAt(line.from).number;
        const state = view.state.field(gitGutterField);
        if (!resolveRangeAtLine(state.ranges, lineNumber)) {
          return false;
        }
        const navigate = view.state.facet(gitGutterNavigateFacet);
        if (!navigate) {
          return false;
        }
        navigate(lineNumber);
        event.preventDefault();
        return true;
      },
    },
  });
}

/** 主题 resync 见 createGitGutterThemeResyncPlugin（由 view-extensions 并列装配）。 */
export function createGitGutterExtension(): Extension {
  return [gitGutterField, createGitGutterTrack()];
}
