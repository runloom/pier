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

  [data-metadata] > [data-deletions-count],
  [data-metadata] > [data-additions-count] {
    display: none;
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

export function diffFontMetrics(baseFontSize: string): {
  diffHeaderHeight: number;
  lineHeight: number;
} {
  const rootSize = Number.parseFloat(baseFontSize);
  const codeSize = (Number.isFinite(rootSize) ? rootSize : 16) * 0.8125;
  const lineHeight = codeSize * 1.75;
  return { diffHeaderHeight: lineHeight + 24, lineHeight };
}
