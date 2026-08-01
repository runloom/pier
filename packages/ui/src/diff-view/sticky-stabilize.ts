/**
 * Pierre CodeView.applyStickyPositioning intentionally injects
 * `Math.random() * lineHeight` into the sticky container's top/bottom each
 * time bounds change (paint/overflow workaround). That shows up as a 0–N px
 * vertical shimmy while scrolling multi-diff headers.
 *
 * Replace with a deterministic flush: same geometry, no random offset.
 * Patches the instance once; safe to call repeatedly.
 *
 * `reapply`（默认 true）：在 layout/挂载后强制 flush 当前 bounds。
 * 虚拟化 onPostRender 应传 `reapply: false`——只 patch 一次，避免每帧写 style 造成滚动卡顿。
 */

import { hardenCodeViewInstanceChanged } from "./code-view-runtime.ts";

interface StickyBounds {
  readonly stickyBottom: number;
  readonly stickyTop: number;
}

interface StickyCodeView {
  applyStickyPositioning: (bounds: StickyBounds) => void;
  getHeight: () => number;
  itemMetricsCache: { readonly diffHeaderHeight: number };
  renderState: {
    stickyBottom: number;
    stickyHeight: number;
    stickyTop: number;
  };
  stickyContainer: HTMLElement;
  stickyOffset: HTMLElement;
}

const stabilized = new WeakSet<object>();

function isStickyCodeView(value: unknown): value is StickyCodeView {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<StickyCodeView>;
  return (
    typeof candidate.applyStickyPositioning === "function" &&
    typeof candidate.getHeight === "function" &&
    candidate.itemMetricsCache != null &&
    typeof candidate.itemMetricsCache.diffHeaderHeight === "number" &&
    candidate.renderState != null &&
    candidate.stickyContainer instanceof HTMLElement &&
    candidate.stickyOffset instanceof HTMLElement
  );
}

export function stabilizeCodeViewStickyPositioning(
  viewer: unknown,
  options?: { readonly reapply?: boolean }
): void {
  // Same hot path as sticky patch: install instanceChanged guard before any
  // post-render / layout callback can fire on a recycled Virtualized* instance.
  hardenCodeViewInstanceChanged(viewer);
  if (!isStickyCodeView(viewer)) {
    return;
  }
  if (!stabilized.has(viewer)) {
    stabilized.add(viewer);
    viewer.applyStickyPositioning = function applyStickyPositioningStable({
      stickyBottom,
      stickyTop,
    }: StickyBounds): void {
      const height = this.getHeight();
      const stickyContainerHeight = stickyBottom - stickyTop;
      this.renderState.stickyHeight = stickyContainerHeight;
      this.renderState.stickyTop = stickyTop;
      this.renderState.stickyBottom = stickyBottom;
      this.stickyOffset.style.height = `${stickyTop}px`;
      // Deterministic: pin sticky region so headers stick at viewport top:0.
      const stickyJitter = -Math.max(stickyContainerHeight, 0) + height;
      this.stickyContainer.style.top = `${stickyJitter}px`;
      this.stickyContainer.style.bottom = `${
        stickyJitter + this.itemMetricsCache.diffHeaderHeight
      }px`;
    };
  }
  if (options?.reapply === false) {
    return;
  }
  // Re-apply current bounds even when updateStickyPositioning would early-return
  // because stickyTop/Bottom already match (common after official apply).
  const { stickyBottom, stickyTop } = viewer.renderState;
  if (stickyTop !== -1 && stickyBottom !== -1) {
    viewer.applyStickyPositioning({ stickyBottom, stickyTop });
  }
}
