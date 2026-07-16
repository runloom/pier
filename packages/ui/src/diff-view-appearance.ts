import type { CSSProperties } from "react";

export const CODE_VIEW_CUSTOM_CSS = `
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

  /* Pierre 默认会把空 hunk 汇总成 -0/+0。宿主接管 header 统计后隐藏官方节点，
     只通过 header-metadata 插槽渲染真实非零计数，避免懒加载占位误导。 */
  [data-metadata] > [data-deletions-count],
  [data-metadata] > [data-additions-count] {
    display: none;
  }
`;

export interface DiffTypographyStyle extends CSSProperties {
  "--diffs-font-family": string;
  "--diffs-font-size": string;
  "--diffs-line-height": string;
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
