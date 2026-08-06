import {
  type Extension,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  GutterMarker,
  gutterLineClass,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { EditorView } from "codemirror";
import type { GitGutterKind, GitGutterLineMarker } from "./git-markers.ts";

/**
 * Files 插件 SCM 装饰：左侧 gutter 边条 + 右侧 minimap 色轨共用同一 markers 真源。
 * 官方 gutterLineClass 给该行 gutter 元素加 class；主题只在 first-child 画 inset 边条。
 * minimap 经 showMinimap.compute 读 minimapGutter（已解析的具体色，canvas 不吃 var()）。
 *
 * @see https://codemirror.net/examples/gutter/
 * @see https://codemirror.net/docs/ref/#view.gutterLineClass
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
}

const DIFF_COLOR_VARS: Record<GitGutterKind, string> = {
  added: "--diff-addition-fg",
  deleted: "--diff-deletion-fg",
  modified: "--diff-modification-fg",
};

const EMPTY_MARKERS: ReadonlyMap<number, GitGutterLineMarker> = new Map();

export const EMPTY_GIT_GUTTER_STATE: GitGutterState = {
  gutterMarkers: RangeSet.empty,
  markers: EMPTY_MARKERS,
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

function buildGitGutterState(
  markers: ReadonlyMap<number, GitGutterLineMarker>,
  doc: { line: (n: number) => { from: number }; lines: number },
  colors: ScmDiffColors
): GitGutterState {
  return {
    gutterMarkers: buildGutterMarkers(markers, doc),
    markers,
    minimapGutter: markersToMinimapGutter(markers, colors, {
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

/**
 * 短路须含 gutter RangeSet：文档变更后 marker 语义可不变，但行起点偏移，
 * 若不重建 RangeSet，左侧边条会停在旧偏移，与 minimap 行号色点脱节。
 */
function gitGutterStateEqual(a: GitGutterState, b: GitGutterState): boolean {
  return (
    markersContentEqual(a.markers, b.markers) &&
    minimapGutterEqual(a.minimapGutter, b.minimapGutter) &&
    RangeSet.eq([a.gutterMarkers], [b.gutterMarkers])
  );
}

/** SCM 装饰 field：gutter + minimap 共用。minimap 扩展依赖此 field 重算 gutters。 */
export const gitGutterField = StateField.define<GitGutterState>({
  create: () => EMPTY_GIT_GUTTER_STATE,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setGitGutterStateEffect)) {
        return e.value;
      }
    }
    return value;
  },
  provide: (field) =>
    gutterLineClass.from(field, (value) => value.gutterMarkers),
});

function colorScope(view: EditorView): Element {
  return view.dom.isConnected ? view.dom : document.documentElement;
}

export function setGitGutterMarkers(
  view: EditorView,
  markers: ReadonlyMap<number, GitGutterLineMarker>
): void {
  const next = buildGitGutterState(
    markers,
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

export function clearGitGutterMarkers(view: EditorView): void {
  const prev = view.state.field(gitGutterField);
  if (prev.markers.size === 0 && Object.keys(prev.minimapGutter).length === 0) {
    return;
  }
  view.dispatch({
    effects: setGitGutterStateEffect.of(EMPTY_GIT_GUTTER_STATE),
  });
}

/**
 * 主题 class（light/dark）变化时重解析 --diff-*-fg，不重拉 git。
 * 仅当已有 markers 时 dispatch。
 */
function createThemeResyncPlugin(): Extension {
  return ViewPlugin.fromClass(
    class {
      readonly #view: EditorView;
      readonly #observer: MutationObserver;
      #destroyed = false;
      #themeKey: string;

      constructor(view: EditorView) {
        this.#view = view;
        this.#themeKey = readDocumentThemeKey();
        this.#observer = new MutationObserver(() => {
          this.#resyncIfThemeChanged();
        });
        if (typeof document !== "undefined") {
          this.#observer.observe(document.documentElement, {
            attributeFilter: ["class"],
            attributes: true,
          });
        }
      }

      update(_update: ViewUpdate): void {
        // MutationObserver 是主题主路径；此处兜底同帧 class 已变但 observer 未跑的情况。
        this.#resyncIfThemeChanged();
      }

      destroy(): void {
        this.#destroyed = true;
        this.#observer.disconnect();
      }

      #resyncIfThemeChanged(): void {
        const key = readDocumentThemeKey();
        if (key === this.#themeKey) {
          return;
        }
        this.#themeKey = key;
        if (this.#view.state.field(gitGutterField).markers.size === 0) {
          return;
        }
        // 避免在 update 循环内同步 dispatch：推到微任务。
        // 微任务内重读 field：中间若 clear/刷新清空，不得用捕获快照复活装饰。
        queueMicrotask(() => {
          if (this.#destroyed) {
            return;
          }
          const { markers } = this.#view.state.field(gitGutterField);
          if (markers.size === 0) {
            return;
          }
          setGitGutterMarkers(this.#view, markers);
        });
      }
    }
  );
}

function readDocumentThemeKey(): string {
  if (typeof document === "undefined") {
    return "";
  }
  return document.documentElement.className;
}

export function createGitGutterExtension(): Extension {
  return [gitGutterField, createThemeResyncPlugin()];
}
