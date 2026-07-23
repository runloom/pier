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
`;
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

export function diffFontMetrics(baseFontSize: string): {
  diffHeaderHeight: number;
  lineHeight: number;
} {
  const rootSize = Number.parseFloat(baseFontSize);
  const codeSize = (Number.isFinite(rootSize) ? rootSize : 16) * 0.8125;
  const lineHeight = codeSize * 1.75;
  return { diffHeaderHeight: DIFF_HEADER_HEIGHT_PX, lineHeight };
}
