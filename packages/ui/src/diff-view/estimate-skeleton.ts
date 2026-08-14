/**
 * Pier Diff / Review 骨架几何金标准（单源）。
 *
 * ## 产品对照（本仓库实测）
 * | 表面 | 真实 UI | 骨架应对齐 |
 * |------|---------|------------|
 * | Diff 文件头 | `padding-inline: 12px`（appearance） | 正文骨架左右 **12**，不伪造 gutter |
 * | 代码行 | mono + line-height 1.75；行号 gutter 由 Pierre 自绘 | estimate **不** 预留 28–48 假 gutter |
 * | 文件树 | `--trees-padding-inline-override: 4px`；行 ~28px | 树骨架 pad 4、行高 28 |
 * | 侧栏底色 | `--sidebar: var(--muted)` | **禁止** `bg-muted` 做树骨架（与底同色 → 看不见） |
 *
 * ## 正文 estimate 原则
 * - 骨架是「代码即将出现」的轻提示，不是二次 gutter 布局
 * - 左右贴齐 header 内容边（12px），条长短错落
 * - 条高略低于真行高，避免灰条比真代码更「厚」
 *
 * @see docs/superpowers/specs/2026-07-31-git-review-gold-standard-endstate-design.md §8.3
 */

/** 骨架行数。 */
export const PIER_DIFF_ESTIMATE_SKELETON_LINES = 5;

/**
 * 各行宽度（相对正文列），长短错落像真实代码。
 */
export const PIER_DIFF_ESTIMATE_SKELETON_BAR_WIDTHS = [
  "92%",
  "68%",
  "84%",
  "48%",
  "76%",
] as const;

/** 行条高度（px）：略低于真 code 行，避免骨架比真文更厚。 */
export const PIER_DIFF_ESTIMATE_SKELETON_BAR_HEIGHT_PX = 12;

/** 行距（px）。 */
export const PIER_DIFF_ESTIMATE_SKELETON_GAP_PX = 8;

/**
 * 正文骨架左右内边距 = Diff header `padding-inline`（12）。
 * 禁止 28/48 假 gutter：用户反馈过大，且与真代码列起点无关（行号在 shadow 内自绘）。
 */
export const PIER_DIFF_ESTIMATE_SKELETON_PAD_LEFT_PX = 12;
export const PIER_DIFF_ESTIMATE_SKELETON_PAD_RIGHT_PX = 12;
export const PIER_DIFF_ESTIMATE_SKELETON_PAD_Y_PX = 8;

// ——— 文件树骨架（与 pierFileTreeStyle 对齐）———

/** 与 `--trees-padding-inline-override: 4px` 一致。 */
export const PIER_TREE_SKELETON_PAD_X_PX = 4;
/** 与产品行密度 28px（h-7）一致。 */
export const PIER_TREE_SKELETON_ROW_HEIGHT_PX = 28;
/** 每级缩进。 */
export const PIER_TREE_SKELETON_INDENT_PX = 12;
/** 图标占位。 */
export const PIER_TREE_SKELETON_ICON_PX = 14;
/** 文件名条高度。 */
export const PIER_TREE_SKELETON_BAR_HEIGHT_PX = 12;

const SKELETON_HOST_ATTR = "data-pier-estimate-skeleton";
const SKELETON_BAR_ATTR = "data-pier-estimate-skeleton-bar";
/** onPostRender 打在 diffs-container 上的 estimate 标记。 */
export const PIER_DIFF_ESTIMATE_ATTR = "data-pier-estimate";

/**
 * 在 diffs-container 的 shadowRoot 内同步骨架节点。
 * 条几何用 inline style 钉死（高/宽/色），不单靠 host CSS。
 */
export function syncEstimateSkeleton(
  element: HTMLElement,
  isEstimate: boolean,
  reservedBodyHeightPx?: number
): void {
  const root = element.shadowRoot;
  if (root == null) {
    return;
  }
  const existing = root.querySelector<HTMLElement>(`[${SKELETON_HOST_ATTR}]`);
  if (!isEstimate) {
    existing?.remove();
    return;
  }
  if (existing != null) {
    applyEstimateSkeletonReserve(existing, reservedBodyHeightPx);
    return;
  }
  const host = document.createElement("div");
  host.setAttribute(SKELETON_HOST_ATTR, "");
  host.style.display = "flex";
  host.style.boxSizing = "border-box";
  host.style.flexDirection = "column";
  host.style.gap = `${PIER_DIFF_ESTIMATE_SKELETON_GAP_PX}px`;
  host.style.width = "100%";
  host.style.padding = `${PIER_DIFF_ESTIMATE_SKELETON_PAD_Y_PX}px ${PIER_DIFF_ESTIMATE_SKELETON_PAD_RIGHT_PX}px ${PIER_DIFF_ESTIMATE_SKELETON_PAD_Y_PX}px ${PIER_DIFF_ESTIMATE_SKELETON_PAD_LEFT_PX}px`;
  applyEstimateSkeletonReserve(host, reservedBodyHeightPx);
  for (const width of PIER_DIFF_ESTIMATE_SKELETON_BAR_WIDTHS) {
    const bar = document.createElement("div");
    bar.setAttribute(SKELETON_BAR_ATTR, "");
    bar.style.flex = "0 0 auto";
    bar.style.height = `${PIER_DIFF_ESTIMATE_SKELETON_BAR_HEIGHT_PX}px`;
    bar.style.width = width;
    bar.style.maxWidth = "100%";
    bar.style.borderRadius = "3px";
    // Canvas 系：内容区背景上可见；不依赖 muted token
    bar.style.backgroundColor = "color-mix(in oklab, CanvasText 14%, Canvas)";
    bar.style.backgroundImage =
      "linear-gradient(90deg, transparent 0%, color-mix(in oklab, CanvasText 10%, transparent) 45%, transparent 90%)";
    bar.style.backgroundSize = "200% 100%";
    host.appendChild(bar);
  }
  const fill = document.createElement("div");
  fill.setAttribute("data-pier-estimate-skeleton-fill", "");
  fill.style.flex = "1 1 auto";
  fill.style.minHeight = "0";
  fill.style.backgroundColor = "color-mix(in oklab, CanvasText 6%, Canvas)";
  host.appendChild(fill);
  root.appendChild(host);
}

function applyEstimateSkeletonReserve(
  host: HTMLElement,
  reservedBodyHeightPx: number | undefined
): void {
  if (
    reservedBodyHeightPx === undefined ||
    !Number.isFinite(reservedBodyHeightPx)
  ) {
    host.style.minHeight = "";
    return;
  }
  host.style.minHeight = `${Math.max(0, reservedBodyHeightPx)}px`;
}

/**
 * 折叠意图变化后批量重算骨架可见性。
 *
 * 骨架挂在 shadowRoot 上、是 Pierre 折叠区的兄弟节点，收起时不会被一起藏掉，
 * 所以必须显式增删。`setAllCollapsed` 对 estimate 槽不写翻转（没有正文可展开），
 * 那些槽不会重新 onPostRender，只能在这里补一次。只遍历已渲染项，受虚拟化约束。
 */
export function syncRenderedEstimateSkeletons(
  elements: Iterable<Element>,
  showSkeleton: boolean
): void {
  for (const element of elements) {
    if (
      element instanceof HTMLElement &&
      element.getAttribute(PIER_DIFF_ESTIMATE_ATTR) === "true"
    ) {
      syncEstimateSkeleton(element, showSkeleton);
    }
  }
}
