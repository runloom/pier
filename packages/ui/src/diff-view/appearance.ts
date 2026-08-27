import type { CSSProperties } from "react";
import { SCROLLBAR_SYSTEM_CSS } from "../scrollbar-system.ts";
import { DIFF_CONTENT_PADDING_BOTTOM_PX } from "./geometry.ts";

/**
 * CodeView unsafeCSS：系统滚动条 + Diff 产品壳。
 * 条尺寸来自 SCROLLBAR_SYSTEM_CSS；头高 / 行高 / 文件体底垫走 geometry CSS 变量。
 */
export const CODE_VIEW_CUSTOM_CSS = `
${SCROLLBAR_SYSTEM_CSS}

  /*
   * 正文：浏览器字符级选区（非整行 data-selected-line）。
   * 行号栏 Pierre 官方已是 user-select:none + 整行选；gutter + 由
   * use-content-selection 拦截，不写行选。
   * 选区底色走主题原有 --editor-selection-bg（与 CodeMirror 同源），
   * 不跟品牌主色，也不用 UA / 系统强调色。
   */
  pre,
  [data-code],
  [data-line],
  [data-content] {
    -webkit-user-select: text;
    user-select: text;
  }

  *::selection {
    background-color: var(--editor-selection-bg);
    color: inherit;
  }

  [data-diffs-header] {
    container-type: scroll-state;
    container-name: sticky-header;
  }

  /*
   * Header row:
   *   [collapse | type | path]  [ +N  ....................  actions ]
   *
   * Pierre structure (shadow):
   *   [data-diffs-header]
   *     [data-header-content]  prefix slot | icon | title
   *     [data-metadata]        built-in counts | metadata slot
   *
   * React metadata must be ONE root node (not a Fragment). The slot is
   * content-sized by default — force it to fill [data-metadata] so
   * margin-inline-start:auto on actions reaches the true right edge.
   */
  [data-diffs-header="default"] {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    /* Tighter than Pierre default (1lh + 3×8 ≈ 47): 32px chrome row. */
    gap: 6px;
    /*
     * 必须等于喂给 Pierre 的 itemMetrics.diffHeaderHeight（整数 CSS px）。
     * Pierre 折叠项只信这个估值、不重测 DOM；min-height 也钉同一变量，
     * 避免官方 calc(1lh + 3x gap) 把头撑高。
     */
    height: var(--pier-diff-header-height, 32px);
    min-height: var(--pier-diff-header-height, 32px);
    padding-block: 4px;
    padding-inline: 12px;
    width: 100%;
    box-sizing: border-box;
    cursor: pointer;
  }

  /* 底垫 = itemMetrics.paddingBottom；盖 Pierre gap−gutter，gutter overlay。 */
  [data-code] {
    padding-bottom: var(--pier-diff-content-padding-bottom, ${DIFF_CONTENT_PADDING_BOTTOM_PX}px);
    scrollbar-gutter: auto;
  }

  [data-overflow="wrap"][data-diff-type="split"] {
    padding-top: 0;
    padding-bottom: var(--pier-diff-content-padding-bottom, ${DIFF_CONTENT_PADDING_BOTTOM_PX}px);
  }

  /* Whole-header hover (VS Code multi-diff chrome). */
  [data-diffs-header="default"]:hover {
    background-color: color-mix(
      in oklab,
      var(--muted, var(--diffs-mixer)) 55%,
      var(--background, var(--diffs-bg))
    );
  }

  [data-diffs-header="default"] > [data-header-content] {
    flex: 0 1 auto;
    min-width: 0;
    /* Leave room for stats + icon actions on the right. */
    max-width: calc(100% - 8.5rem);
  }

  [data-diffs-header="default"] > [data-metadata] {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    min-width: 0;
    /* Drop pierre's default 1ch gap against empty count nodes. */
    gap: 0;
  }

  /* Slot host must stretch; otherwise assigned light DOM stays content-width. */
  [data-diffs-header="default"] > [data-metadata] > slot[name="header-metadata"] {
    display: block;
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
  }

  [data-slot="pier-diff-header-metadata"] {
    display: flex;
    width: 100%;
    min-width: 0;
    align-items: center;
    gap: 0.5rem;
    box-sizing: border-box;
  }

  [data-slot="pier-diff-header-stats"] {
    flex: 0 0 auto;
  }

  [data-slot="pier-diff-header-actions"] {
    flex: 0 0 auto;
    margin-inline-start: auto;
  }

  /* Built-in pierre counts hidden; we render colored stats in the metadata slot. */
  [data-metadata] > [data-deletions-count],
  [data-metadata] > [data-additions-count] {
    display: none;
  }

  /*
   * Sticky flush: opaque product bg + 1px top skirt for residual subpixel leak.
   * Vertical jitter is removed in stabilizeCodeViewStickyPositioning (no Math.random).
   */
  [data-diffs-header][data-sticky] {
    top: 0;
    z-index: 3;
    background-color: var(--background, var(--diffs-bg));
  }

  [data-diffs-header][data-sticky]::before {
    position: absolute;
    top: -1px;
    right: 0;
    left: 0;
    z-index: -1;
    height: 1px;
    content: "";
    background-color: var(--background, var(--diffs-bg));
  }

  [data-diffs-header][data-sticky]:hover,
  [data-diffs-header][data-sticky]:hover::before {
    background-color: color-mix(
      in oklab,
      var(--muted, var(--diffs-mixer)) 55%,
      var(--background, var(--diffs-bg))
    );
  }

  /*
   * Path open-file affordance：cursor 仅 CSS 兜底。
   * mono + hover 下划线的**权威路径**是 path-title-chrome.ts（onPostRender）。
   * 不在此用 text-decoration 画 hover——HMR/层叠下不可靠，且与 postRender 双轨会打架。
   */
  [data-header-content] [data-title] {
    cursor: pointer;
  }

  @container sticky-header scroll-state(stuck: top) {
    [data-diffs-header]::after {
      position: absolute;
      bottom: -1px;
      left: 0;
      width: 100%;
      height: 1px;
      content: '';
      background-color: var(--diffshub-annotation-border);
    }
  }

  /*
   * Host attrs (data-pier-file-host / estimate) live on <diffs-container>.
   * Inside shadow CSS they must be addressed with :host(...), not as
   * descendant selectors (the host is not a descendant of the shadow root).
   *
   * Annotation *content* (data-pier-hunk-actions) is light DOM portal children
   * of the host — shadow styles cannot reach them. Hover reveal is owned by
   * PIER_DIFF_LIGHT_DOM_CSS (document stylesheet).
   */
  :host([data-pier-file-host]) {
    overflow: visible;
  }

  /*
   * Codex Tn is absolute -top-*; Pierre core sets code { contain: content }
   * which paint-clips overflow. Soften so pills above the anchor line show.
   */
  :host([data-pier-file-host]) code {
    contain: style;
    overflow: visible;
  }

  :host([data-pier-file-host]) pre {
    overflow: visible;
  }

  /*
   * Codex Tn sits absolute over a line-level annotation slot. Pierre keeps
   * this content sticky at the visible code-column inset in scroll mode and
   * measures its width from the viewport column. Do not override position,
   * left or width here: right-aligning against the full long-line canvas puts
   * the action pill outside the horizontal viewport.
   */
  :host([data-pier-file-host]) [data-annotation-content] {
    min-height: 0;
    overflow: visible;
  }

  :host([data-pier-file-host]) [data-line-annotation] {
    --diffs-annotation-min-height: 0;
    overflow: visible;
  }

  /*
   * 批注行底色压回普通代码行。
   *
   * Pierre 默认把批注行当「上下文块」：style.js 给 [data-line-annotation] 设
   * --diffs-annotation-bg: var(--diffs-bg-context)（暗色 = 代码行底 + 7.5% 白），
   * 给 [data-gutter-buffer="annotation"] 再单独设 --diffs-bg-context-gutter
   * （只有 45% 灰）。于是行内评论行渲染成「两侧接近正常 + 中间一块灰」。
   *
   * 行内评论不是上下文块，是挂在这一行上的批注，底色必须与所在文件其它行完全
   * 一致。--diffs-annotation-bg 是 pierre 那条规则里 decoration / diff-line /
   * selected-line / line-bg 四个 computed 变量的唯一上游，所以只需改这一个：
   * 选中蓝与 hover 混色仍按普通行的公式算，不会被拉偏。
   *
   * 这正是 pierre 自己在 [data-has-merge-conflict] 下压平批注行的同款做法。
   * 卡片侧一律 bg-transparent，不要改回在卡片上铺 surface——那样会盖掉选中蓝。
   */
  :host([data-pier-file-host]) [data-line-annotation],
  :host([data-pier-file-host]) [data-gutter-buffer='annotation'] {
    --diffs-annotation-bg: var(--diffs-bg);
  }

  /*
   * estimate 槽：shadow 内真实节点 [data-pier-estimate-skeleton]
   * （estimate-skeleton.ts 注入）。禁止 :host::after 画条。
   * 固定 5 条；槽高由 geometry.skeletonSlotHeight，不按 numstat 拉高。
   */
  :host([data-pier-estimate="true"]) {
    min-height: 0;
  }

  :host([data-pier-estimate="true"]) [data-code],
  :host([data-pier-estimate="true"]) pre {
    display: none !important;
  }

  :host([data-pier-estimate="true"]) [data-pier-estimate-skeleton] {
    display: flex;
    box-sizing: border-box;
    flex-direction: column;
    width: 100%;
    gap: 8px;
    padding: 8px 12px;
    --pier-skel-a: color-mix(
      in oklab,
      var(--muted, var(--diffs-mixer)) 42%,
      var(--background, var(--diffs-bg))
    );
    --pier-skel-b: color-mix(
      in oklab,
      var(--muted-foreground, var(--diffs-mixer)) 14%,
      var(--muted, var(--diffs-mixer))
    );
  }

  :host([data-pier-estimate="true"]) [data-pier-estimate-skeleton-bar] {
    flex: 0 0 auto;
    height: 12px;
    max-width: 100%;
    border-radius: 3px;
    background-image: linear-gradient(
      90deg,
      var(--pier-skel-a) 0%,
      var(--pier-skel-b) 45%,
      var(--pier-skel-a) 90%
    );
    background-size: 200% 100%;
    background-position: 100% 0;
    animation: pier-estimate-skeleton-shimmer 1.5s ease-in-out infinite;
  }

  @keyframes pier-estimate-skeleton-shimmer {
    0% { background-position: 100% 0; }
    100% { background-position: -100% 0; }
  }

  /*
   * Image diffs: hide the dummy context line / unused split column so the
   * file-level annotation (2-up / swipe / onion) is the body.
   *
   * Split files keep two 1fr columns even after hiding deletions, so the
   * compare lands in the left half. Collapse to one column and center the
   * inner fit-content group in the full file.
   */
  :host([data-pier-image-diff]) [data-line]:not([data-line-annotation]) {
    display: none !important;
  }

  :host([data-pier-image-diff]) [data-gutter]:not([data-gutter-buffer="annotation"]) {
    display: none !important;
  }

  :host([data-pier-image-diff="compare"]) [data-deletions] {
    display: none !important;
  }

  :host([data-pier-image-diff="deleted"]) [data-additions] {
    display: none !important;
  }

  :host([data-pier-image-diff]) [data-diff-type="split"] {
    grid-template-columns: minmax(0, 1fr);
  }

  :host([data-pier-image-diff]) [data-diff-type="split"][data-overflow="wrap"] {
    grid-template-columns: var(--diffs-code-grid);
  }

  :host([data-pier-image-diff]) [data-diff-type="split"] [data-additions],
  :host([data-pier-image-diff]) [data-diff-type="split"] [data-deletions] {
    border-inline-width: 0;
  }

  :host([data-pier-image-diff]) [data-overflow="wrap"] [data-additions] [data-gutter],
  :host([data-pier-image-diff]) [data-overflow="wrap"] [data-deletions] [data-gutter] {
    grid-column: 1;
  }

  :host([data-pier-image-diff]) [data-overflow="wrap"] [data-additions] [data-content],
  :host([data-pier-image-diff]) [data-overflow="wrap"] [data-deletions] [data-content] {
    grid-column: 2;
  }

  :host([data-pier-image-diff]) [data-line-annotation] {
    padding-inline: 0;
  }

  :host([data-pier-image-diff]) [data-annotation-content] {
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    left: auto;
    position: relative;
  }
`;

/**
 * Document-level CSS for light-DOM annotation pills (React portals on
 * <diffs-container>). Shadow unsafeCSS cannot style these descendants.
 *
 * Host is marked data-pier-file-host in onPostRender. Pierre renders the code
 * in shadow DOM, so onPostRender also mirrors pointer entry to
 * data-pier-pointer-within; :hover remains a browser fallback.
 */
export const PIER_DIFF_LIGHT_DOM_CSS = `
  [data-slot="pier-image-diff"] {
    -webkit-user-select: none;
    user-select: none;
  }

  [data-slot="pier-image-diff-image"],
  [data-slot="pier-image-diff-stage"],
  [data-slot="pier-image-diff-checker"] {
    background-color: var(--muted);
    background-image: repeating-conic-gradient(
      from 90deg at 50% 50%,
      var(--background) 0% 25%,
      transparent 0% 50%
    );
    background-size: 12px 12px;
  }

  diffs-container[data-pier-file-host] [data-pier-hunk-actions] {
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease;
  }

  diffs-container[data-pier-file-host][data-pier-pointer-within] [data-pier-hunk-actions],
  diffs-container[data-pier-file-host]:hover [data-pier-hunk-actions],
  diffs-container[data-pier-file-host]:focus-within [data-pier-hunk-actions],
  diffs-container[data-pier-file-host] [data-pier-hunk-actions]:focus-within {
    opacity: 1;
    pointer-events: auto;
  }
`;

export const PIER_DIFF_LIGHT_DOM_STYLE_ID = "pier-diff-light-dom-css";

/** Idempotent inject of light-DOM hunk hover styles into document.head. */
export function ensurePierDiffLightDomStyles(): void {
  if (typeof document === "undefined") {
    return;
  }
  if (document.getElementById(PIER_DIFF_LIGHT_DOM_STYLE_ID) != null) {
    return;
  }
  const style = document.createElement("style");
  style.id = PIER_DIFF_LIGHT_DOM_STYLE_ID;
  style.textContent = PIER_DIFF_LIGHT_DOM_CSS;
  document.head.appendChild(style);
}

export interface DiffTypographyStyle extends CSSProperties {
  "--diffs-font-family": string;
  "--diffs-font-size": string;
  "--diffs-line-height": string;
  "--diffs-scrollbar-gutter-override": string;
  "--diffshub-annotation-border": string;
  "--diffshub-diff-separator": string;
  "--pier-diff-content-padding-bottom": string;
  "--pier-diff-header-height": string;
}

/** geometry 公开面：虚拟高度唯一真源。 */
export {
  DIFF_CONTENT_PADDING_BOTTOM_PX,
  DIFF_HEADER_MIN_HEIGHT_PX,
  DIFF_ITEM_GAP_PX,
  type DiffMetrics,
  diffFontMetrics,
  diffMetrics,
  slotVirtualHeight,
  totalScrollHeight,
} from "./geometry.ts";

/**
 * Dual theme pair + colorMode identity for remount / render-watchdog.
 * Pierre CodeView.onThemeChange only invalidates the element pool (no render).
 */
export function pierDiffThemeKey(parts: {
  readonly codeThemes: {
    readonly dark: string;
    readonly light: string;
  };
  readonly colorMode: "dark" | "light";
}): string {
  return `${parts.codeThemes.dark}|${parts.codeThemes.light}|${parts.colorMode}`;
}

/**
 * CodeView remount key for layout + theme invariants.
 * Item membership / stage / demand 不得进入此 key——成员变更走实例内 sync（见 diff-view-item-sync）。
 * themeKey 必进：Pierre CodeView.onThemeChange 只 invalidate 元素池不 re-render。
 */
export function pierDiffCodeViewKey(parts: {
  diffStyle: string;
  lineHeight: number;
  overflow: string;
  renderMode: string;
  themeKey: string;
}): string {
  return `${parts.renderMode}\0selection=uncontrolled\0${parts.diffStyle}\0${parts.overflow}\0lh=${parts.lineHeight}\0theme=${parts.themeKey}`;
}

/** Watchdog generation: mode / theme / metrics / presentation. */
export function pierDiffRenderEnvironment(parts: {
  readonly diffStyle: string;
  readonly lineHeight: number;
  readonly metricsDiffHeaderHeight: number;
  readonly overflow: string;
  readonly renderMode: string;
  readonly themeKey: string;
}): string {
  return `${parts.renderMode}\0${parts.themeKey}\0${parts.metricsDiffHeaderHeight}\0${parts.lineHeight}\0${parts.diffStyle}\0${parts.overflow}`;
}
