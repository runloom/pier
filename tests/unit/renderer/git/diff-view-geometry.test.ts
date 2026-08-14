import {
  DIFF_HEADER_MIN_HEIGHT_PX,
  DIFF_ITEM_GAP_PX,
  diffFontMetrics,
  diffMetrics,
  skeletonBodyHeightPx,
  slotVirtualHeight,
  totalScrollHeight,
} from "@pier/ui/diff-view/geometry.ts";
import { describe, expect, it } from "vitest";

describe("diffMetrics / slotVirtualHeight（几何单源）", () => {
  it("13px：lineHeight 22.75 / header 34.75 / skeletonBody 108 / skeletonSlot 142.75", () => {
    const m = diffMetrics("13px");
    expect(m.lineHeight).toBeCloseTo(22.75);
    expect(m.headerHeight).toBeCloseTo(34.75);
    expect(m.skeletonBodyHeight).toBe(108);
    expect(m.skeletonSlotHeight).toBeCloseTo(142.75);
    expect(m.gap).toBe(DIFF_ITEM_GAP_PX);
    expect(m.contentPaddingBottom).toBe(8);
    expect(skeletonBodyHeightPx()).toBe(108);
  });

  it("小字号夹到 header 下限 32", () => {
    expect(diffMetrics("8px").headerHeight).toBe(DIFF_HEADER_MIN_HEIGHT_PX);
  });

  it("16px：header / lineHeight 随字号变", () => {
    const m = diffMetrics("16px");
    expect(m.lineHeight).toBeCloseTo(28);
    expect(m.headerHeight).toBeCloseTo(40);
  });

  it("diffFontMetrics 是 thin wrapper", () => {
    const m = diffMetrics("13px");
    const legacy = diffFontMetrics("13px");
    expect(legacy.diffHeaderHeight).toBe(m.headerHeight);
    expect(legacy.lineHeight).toBe(m.lineHeight);
  });

  it("折叠 / notice / error → header", () => {
    const metrics = diffMetrics("13px");
    expect(
      slotVirtualHeight({
        collapsed: true,
        kind: "loaded",
        metrics,
        contentLines: 100,
      })
    ).toBe(metrics.headerHeight);
    expect(
      slotVirtualHeight({ collapsed: false, kind: "notice", metrics })
    ).toBe(metrics.headerHeight);
    expect(
      slotVirtualHeight({ collapsed: false, kind: "error", metrics })
    ).toBe(metrics.headerHeight);
  });

  it("estimate 未折叠且无数 → skeletonSlot", () => {
    const metrics = diffMetrics("13px");
    expect(
      slotVirtualHeight({ collapsed: false, kind: "estimate", metrics })
    ).toBe(metrics.skeletonSlotHeight);
  });

  it("estimate 未折叠按 numstat 预留，并夹到 48 行", () => {
    const metrics = diffMetrics("13px");
    const reserved = slotVirtualHeight({
      collapsed: false,
      contentLines: 40,
      kind: "estimate",
      metrics,
    });
    expect(reserved).toBeGreaterThan(metrics.skeletonSlotHeight);
    expect(reserved).toBeCloseTo(
      metrics.headerHeight +
        40 * metrics.lineHeight +
        metrics.contentPaddingBottom
    );
    expect(
      slotVirtualHeight({
        collapsed: false,
        contentLines: 2000,
        kind: "estimate",
        metrics,
      })
    ).toBeCloseTo(
      metrics.headerHeight +
        48 * metrics.lineHeight +
        metrics.contentPaddingBottom
    );
  });

  it("loaded 展开 → header + lines×lh + pad", () => {
    const metrics = diffMetrics("13px");
    const lines = 10;
    expect(
      slotVirtualHeight({
        collapsed: false,
        contentLines: lines,
        kind: "loaded",
        metrics,
      })
    ).toBeCloseTo(
      metrics.headerHeight +
        lines * metrics.lineHeight +
        metrics.contentPaddingBottom
    );
  });

  it("loaded 0 行展开 → 仅 header（无 pad）", () => {
    const metrics = diffMetrics("13px");
    expect(
      slotVirtualHeight({
        collapsed: false,
        contentLines: 0,
        kind: "loaded",
        metrics,
      })
    ).toBe(metrics.headerHeight);
  });
});

describe("totalScrollHeight", () => {
  it("Σ heights + (n-1)×gap", () => {
    expect(totalScrollHeight([10, 20, 30], 1)).toBe(10 + 1 + 20 + 1 + 30);
    expect(totalScrollHeight([], 1)).toBe(0);
    expect(totalScrollHeight([40], 1)).toBe(40);
  });

  it("折叠全部 n=40：总高 = n×header + (n-1)×gap", () => {
    const metrics = diffMetrics("13px");
    const n = 40;
    const heights = Array.from({ length: n }, () => metrics.headerHeight);
    const expected = n * metrics.headerHeight + (n - 1) * metrics.gap;
    expect(totalScrollHeight(heights, metrics.gap)).toBeCloseTo(expected);
    // 视口 700 时拇指占比应合理（不再短得离谱）
    expect(700 / expected).toBeGreaterThan(0.4);
  });
});
