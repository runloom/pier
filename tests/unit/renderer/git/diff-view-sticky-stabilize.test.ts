import {
  DIFF_HEADER_MIN_HEIGHT_PX,
  diffFontMetrics,
  pierDiffCodeViewKey,
} from "@pier/ui/diff-view/appearance.ts";
import { stabilizeCodeViewStickyPositioning } from "@pier/ui/diff-view/sticky-stabilize.ts";
import { describe, expect, it, vi } from "vitest";

describe("diff header metrics", () => {
  it("derives header height from lineHeight so Pierre's collapsed estimate matches the DOM", () => {
    expect(DIFF_HEADER_MIN_HEIGHT_PX).toBe(32);
    // 实测渲染高度 = 标题行盒 lineHeight + padding-block 8 + 标题槽 4px 余量。
    // 声明值必须等于它：Pierre 折叠项不重测 DOM，差值会按折叠项个数线性累积成滚动错位。
    expect(diffFontMetrics("13px").diffHeaderHeight).toBeCloseTo(34.75);
    expect(diffFontMetrics("16px").diffHeaderHeight).toBeCloseTo(40);
    // 极小字号仍不低于 32px chrome floor（与 CSS min-height 一致）
    expect(diffFontMetrics("8px").diffHeaderHeight).toBe(32);
    expect(diffFontMetrics("13px").lineHeight).toBeCloseTo(22.75);
    expect(diffFontMetrics("16px").lineHeight).toBeCloseTo(28);
  });

  it("pierDiffCodeViewKey remounts when lineHeight (codeFontSize) changes", () => {
    const base = {
      diffStyle: "split",
      overflow: "scroll",
      renderMode: "worker",
    } as const;
    const small = pierDiffCodeViewKey({
      ...base,
      lineHeight: diffFontMetrics("13px").lineHeight,
      themeKey: "github-dark|github-light|dark",
    });
    const large = pierDiffCodeViewKey({
      ...base,
      lineHeight: diffFontMetrics("16px").lineHeight,
      themeKey: "github-dark|github-light|dark",
    });
    expect(small).not.toBe(large);
    expect(small).toContain("lh=");
    expect(large).toContain(`lh=${diffFontMetrics("16px").lineHeight}`);
  });

  it("pierDiffCodeViewKey does not include item membership (no topology remount)", () => {
    const key = pierDiffCodeViewKey({
      diffStyle: "split",
      lineHeight: 22.75,
      overflow: "scroll",
      renderMode: "worker",
      themeKey: "github-dark|github-light|dark",
    });
    expect(key).not.toContain("topology");
    expect(key).toBe(
      pierDiffCodeViewKey({
        diffStyle: "split",
        lineHeight: 22.75,
        overflow: "scroll",
        renderMode: "worker",
        themeKey: "github-dark|github-light|dark",
      })
    );
  });

  it("pierDiffCodeViewKey remounts when color mode flips", () => {
    const dark = pierDiffCodeViewKey({
      diffStyle: "split",
      lineHeight: 22.75,
      overflow: "scroll",
      renderMode: "worker",
      themeKey: "github-dark|github-light|dark",
    });
    const light = pierDiffCodeViewKey({
      diffStyle: "split",
      lineHeight: 22.75,
      overflow: "scroll",
      renderMode: "worker",
      themeKey: "github-dark|github-light|light",
    });
    expect(dark).not.toBe(light);
  });
});

describe("stabilizeCodeViewStickyPositioning", () => {
  it("replaces random sticky top with a deterministic flush", () => {
    const stickyContainer = document.createElement("div");
    const stickyOffset = document.createElement("div");
    const original = vi.fn();
    const viewer = {
      applyStickyPositioning: original,
      getHeight: () => 400,
      itemMetricsCache: { diffHeaderHeight: 32 },
      renderState: { stickyBottom: 200, stickyHeight: 150, stickyTop: 50 },
      stickyContainer,
      stickyOffset,
    };

    stabilizeCodeViewStickyPositioning(viewer);
    expect(viewer.applyStickyPositioning).not.toBe(original);

    // height 400 - sticky span 150 => top 250; bottom 250 + header 32
    expect(stickyOffset.style.height).toBe("50px");
    expect(stickyContainer.style.top).toBe("250px");
    expect(stickyContainer.style.bottom).toBe("282px");
    expect(viewer.renderState).toMatchObject({
      stickyBottom: 200,
      stickyHeight: 150,
      stickyTop: 50,
    });

    // Second call keeps the patched apply and re-flushes current bounds.
    const patched = viewer.applyStickyPositioning;
    stabilizeCodeViewStickyPositioning(viewer);
    expect(viewer.applyStickyPositioning).toBe(patched);
    expect(stickyContainer.style.top).toBe("250px");

    // 虚拟化热路径：reapply:false 只保留 patch，不再写 style。
    stickyContainer.style.top = "0px";
    stabilizeCodeViewStickyPositioning(viewer, { reapply: false });
    expect(viewer.applyStickyPositioning).toBe(patched);
    expect(stickyContainer.style.top).toBe("0px");
  });

  it("patches without applying when sticky bounds are unset", () => {
    const stickyContainer = document.createElement("div");
    const stickyOffset = document.createElement("div");
    const original = vi.fn();
    const viewer = {
      applyStickyPositioning: original,
      getHeight: () => 400,
      itemMetricsCache: { diffHeaderHeight: 32 },
      renderState: { stickyBottom: -1, stickyHeight: 0, stickyTop: -1 },
      stickyContainer,
      stickyOffset,
    };

    stabilizeCodeViewStickyPositioning(viewer);
    expect(viewer.applyStickyPositioning).not.toBe(original);
    expect(stickyOffset.style.height).toBe("");
    expect(stickyContainer.style.top).toBe("");
  });
});
