/**
 * Diff 虚拟高度：唯一几何真源。
 *
 * 任何 CodeView 槽位的虚拟高、折叠总高、estimate 槽高、demand 估条，
 * 只许从本模块导出的 metrics / slotVirtualHeight / totalScrollHeight 计算。
 * 禁止平行 144 魔法数、estimateLines 估滚动高、后置 recomputeLayout 补丁当主路径。
 *
 * @see plan: Diff 虚拟高度单一几何真源
 */

import {
  PIER_DIFF_ESTIMATE_SKELETON_BAR_HEIGHT_PX,
  PIER_DIFF_ESTIMATE_SKELETON_GAP_PX,
  PIER_DIFF_ESTIMATE_SKELETON_LINES,
  PIER_DIFF_ESTIMATE_SKELETON_PAD_Y_PX,
} from "./estimate-skeleton.ts";

/** Multi-diff 文件头 chrome 下限（与 CSS min-height 同步）。 */
export const DIFF_HEADER_MIN_HEIGHT_PX = 32;

/**
 * 标题行盒之外的固定竖向 chrome：padding-block 4+4 + 标题槽行盒余量。
 * 头高 = max(MIN, round(lineHeight + CHROME))，必须是整数 CSS 像素：
 * 13px 字号 lineHeight 22.75 若不取整，头高 34.75，树跳转 item.top 带 .75，
 * 再叠文件底分隔，align:start 就会空出 1px。
 */
export const DIFF_HEADER_CHROME_PX = 12;

/** 字号 → 行高倍率；CSS --diffs-line-height 必须喂 px，禁止无单位 1.75。 */
export const DIFF_LINE_HEIGHT_RATIO = 1.75;

/**
 * 多文件列表 gap。产品密度固定 1；与 CodeView layout.gap 必须同值。
 * （Pierre 默认 8，Pier 覆盖为 1。）
 */
export const DIFF_ITEM_GAP_PX = 1;

/**
 * 展开有 hunk 时文件体底垫。必须同时喂给 Pierre `itemMetrics.paddingBottom`
 * 和 CSS `--pier-diff-content-padding-bottom`；折叠 / 0 行时不计入。
 * 不要改 `itemMetrics.spacing`（hunk 分隔条 gap 也用它）。
 */
export const DIFF_CONTENT_PADDING_BOTTOM_PX = 8;

export type DiffSlotKind = "estimate" | "loaded" | "notice" | "error";

export interface DiffMetrics {
  /** 展开有内容时的底垫（与 itemMetrics.paddingBottom / CSS 同源）。 */
  readonly contentPaddingBottom: number;
  /** 文件列表 item 间距。 */
  readonly gap: number;
  /** 折叠 / notice 槽高。 */
  readonly headerHeight: number;
  /** 代码行高。 */
  readonly lineHeight: number;
  /** estimate 骨架体高度（不含 header）。 */
  readonly skeletonBodyHeight: number;
  /** estimate 未折叠槽高 = header + skeletonBody。 */
  readonly skeletonSlotHeight: number;
}

/**
 * 历史 numstat 虚高上限。estimate **槽高禁止再读行数**（见 slotVirtualHeight）；
 * 本常量只约束 `estimateVirtualContentLines` 诊断/测试，避免误接回占位。
 */
export const MAX_ESTIMATE_VIRTUAL_LINES = 48;

/** index numstat → 行输入；header +N/−M 用 lineStats，不推 estimate 槽高。 */
export function estimateContentLinesFromLineStats(lineStats?: {
  readonly additions: number;
  readonly deletions: number;
}): number | undefined {
  if (lineStats === undefined) {
    return;
  }
  const total = lineStats.additions + lineStats.deletions;
  return total > 0 ? total : undefined;
}

/** numstat 行数夹紧；**不得**喂给 estimate 槽高。 */
export function estimateVirtualContentLines(
  contentLines: number | undefined
): number {
  if (
    contentLines === undefined ||
    !Number.isFinite(contentLines) ||
    contentLines <= 0
  ) {
    return PIER_DIFF_ESTIMATE_SKELETON_LINES;
  }
  return Math.min(
    MAX_ESTIMATE_VIRTUAL_LINES,
    Math.max(PIER_DIFF_ESTIMATE_SKELETON_LINES, Math.floor(contentLines))
  );
}

/** 骨架体高度：padY×2 + bars + gaps。与 estimate-skeleton 绘制同源。 */
export function skeletonBodyHeightPx(): number {
  const bars = PIER_DIFF_ESTIMATE_SKELETON_LINES;
  return (
    PIER_DIFF_ESTIMATE_SKELETON_PAD_Y_PX * 2 +
    bars * PIER_DIFF_ESTIMATE_SKELETON_BAR_HEIGHT_PX +
    Math.max(0, bars - 1) * PIER_DIFF_ESTIMATE_SKELETON_GAP_PX
  );
}

/**
 * 唯一 metrics 入口。可调输入只有 codeFontSize。
 */
export function diffMetrics(codeFontSize: string): DiffMetrics {
  const parsed = Number.parseFloat(codeFontSize);
  const codeSize = Number.isFinite(parsed) && parsed > 0 ? parsed : 13;
  const lineHeight = codeSize * DIFF_LINE_HEIGHT_RATIO;
  const headerHeight = Math.max(
    DIFF_HEADER_MIN_HEIGHT_PX,
    Math.round(lineHeight + DIFF_HEADER_CHROME_PX)
  );
  const skeletonBodyHeight = skeletonBodyHeightPx();
  return {
    contentPaddingBottom: DIFF_CONTENT_PADDING_BOTTOM_PX,
    gap: DIFF_ITEM_GAP_PX,
    headerHeight,
    lineHeight,
    skeletonBodyHeight,
    skeletonSlotHeight: headerHeight + skeletonBodyHeight,
  };
}

/**
 * 唯一槽位虚拟高度函数。
 * collapsed / notice / error → header；
 * estimate 未折叠 → 始终 header+5 条骨架（忽略 contentLines / numstat）；
 * loaded 展开 → header + lines×lh + pad。
 */
export function slotVirtualHeight(args: {
  readonly collapsed: boolean;
  readonly contentLines?: number;
  readonly kind: DiffSlotKind;
  readonly metrics: DiffMetrics;
}): number {
  const { metrics } = args;
  if (args.collapsed || args.kind === "notice" || args.kind === "error") {
    return metrics.headerHeight;
  }
  if (args.kind === "estimate") {
    return metrics.skeletonSlotHeight;
  }
  const lines = Math.max(0, args.contentLines ?? 0);
  return (
    metrics.headerHeight +
    lines * metrics.lineHeight +
    (lines > 0 ? metrics.contentPaddingBottom : 0)
  );
}

/** 列表总高：Σ heights + (n-1)×gap。 */
export function totalScrollHeight(
  heights: readonly number[],
  gap: number = DIFF_ITEM_GAP_PX
): number {
  if (heights.length === 0) {
    return 0;
  }
  let total = 0;
  for (let index = 0; index < heights.length; index += 1) {
    total += heights[index] ?? 0;
    if (index < heights.length - 1) {
      total += gap;
    }
  }
  return total;
}

/**
 * 兼容旧名：返回 { diffHeaderHeight, lineHeight } 供 itemMetrics 使用。
 */
export function diffFontMetrics(codeFontSize: string): {
  diffHeaderHeight: number;
  lineHeight: number;
} {
  const m = diffMetrics(codeFontSize);
  return {
    diffHeaderHeight: m.headerHeight,
    lineHeight: m.lineHeight,
  };
}
