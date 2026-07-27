import type { CSSProperties } from "react";
import { SCROLLBAR_SYSTEM_CSS } from "./scrollbar-system.ts";

/**
 * CodeView unsafeCSS：系统滚动条 + Diff 产品壳。
 * 尺寸只来自 SCROLLBAR_SYSTEM_CSS。
 */
export const CODE_VIEW_CUSTOM_CSS = `
${SCROLLBAR_SYSTEM_CSS}

  /*
   * 产品选区只有 Pierre 行选（data-selected-line）。
   * 禁止 pre/正文原生文字选区，避免截图里「行高亮 + 蓝选」两套并存。
   * 行号栏官方已是 user-select:none；这里补正文与 pre。
   */
  pre,
  [data-code],
  [data-line],
  [data-content] {
    -webkit-user-select: none;
    user-select: none;
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
    min-height: 32px;
    padding-block: 4px;
    padding-inline: 12px;
    width: 100%;
    box-sizing: border-box;
    cursor: pointer;
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

  /* Path is the open-file target; underline only on the title itself. */
  [data-header-content] [data-title] {
    cursor: pointer;
  }

  [data-header-content] [data-title]:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
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
   * Codex Tn sits absolute over a line-level annotation slot. Keep a normal
   * relative containing block; only disable sticky + left offset that would
   * detach the pill from the change line while scrolling.
   */
  :host([data-pier-file-host]) [data-annotation-content] {
    position: relative;
    left: auto;
    width: 100%;
    min-height: 0;
    overflow: visible;
  }

  :host([data-pier-file-host]) [data-line-annotation] {
    --diffs-annotation-min-height: 0;
    overflow: visible;
  }

  /*
   * estimate 槽：partial 空行在默认主题下像白屏。
   * 用 muted 底 + 降低内容对比，像骨架而非空白文档。
   */
  :host([data-pier-estimate="true"]) [data-code],
  :host([data-pier-estimate="true"]) pre {
    background-color: color-mix(
      in oklab,
      var(--muted, var(--diffs-mixer)) 35%,
      var(--background, var(--diffs-bg))
    );
  }

  :host([data-pier-estimate="true"]) [data-line] {
    opacity: 0.35;
  }
`;

/**
 * Document-level CSS for light-DOM annotation pills (React portals on
 * <diffs-container>). Shadow unsafeCSS cannot style these descendants.
 *
 * Host is marked data-pier-file-host in onPostRender. Hovering any shadow
 * child of the host still matches :hover on the host element.
 */
export const PIER_DIFF_LIGHT_DOM_CSS = `
  diffs-container[data-pier-file-host] [data-pier-hunk-actions] {
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease;
  }

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
}

/** Multi-diff file header chrome height — keep in sync with CSS min-height: 32px. */
export const DIFF_HEADER_HEIGHT_PX = 32;

/**
 * Line metrics for multi-diff CodeView.
 * `codeFontSize` is the resolved code body size (e.g. "13px" from settings).
 */
export function diffFontMetrics(codeFontSize: string): {
  diffHeaderHeight: number;
  lineHeight: number;
} {
  const parsed = Number.parseFloat(codeFontSize);
  const codeSize = Number.isFinite(parsed) && parsed > 0 ? parsed : 13;
  const lineHeight = codeSize * 1.75;
  return { diffHeaderHeight: DIFF_HEADER_HEIGHT_PX, lineHeight };
}

/**
 * CodeView remount key for layout invariants only.
 * Item membership / stage / demand 不得进入此 key——成员变更走实例内 sync（见 diff-view-item-sync）。
 */
export function pierDiffCodeViewKey(parts: {
  diffStyle: string;
  lineHeight: number;
  overflow: string;
  renderMode: string;
}): string {
  return `${parts.renderMode}\0selection=uncontrolled\0${parts.diffStyle}\0${parts.overflow}\0lh=${parts.lineHeight}`;
}
