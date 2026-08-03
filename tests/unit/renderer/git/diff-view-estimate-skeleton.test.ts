import { isUserCollapsedItem } from "@pier/ui/diff-view/collapse-intent.ts";
import {
  PIER_DIFF_ESTIMATE_ATTR,
  syncEstimateSkeleton,
  syncRenderedEstimateSkeletons,
} from "@pier/ui/diff-view/estimate-skeleton.ts";
import { diffMetrics } from "@pier/ui/diff-view/geometry.ts";
import {
  applyDiffVirtualHeights,
  isEstimateCacheKey,
  pinCodeViewScrollHeight,
  resolveItemVirtualHeight,
} from "@pier/ui/diff-view/layout-apply.ts";
import { afterEach, describe, expect, it } from "vitest";

const SKELETON = "[data-pier-estimate-skeleton]";
const METRICS = diffMetrics("13px");

function mountSlot(isEstimate: boolean) {
  const host = document.createElement("div");
  host.attachShadow({ mode: "open" });
  if (isEstimate) {
    host.setAttribute(PIER_DIFF_ESTIMATE_ATTR, "true");
  }
  document.body.append(host);
  return host;
}

function hasSkeleton(host: HTMLElement): boolean {
  return host.shadowRoot?.querySelector(SKELETON) != null;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("isUserCollapsedItem", () => {
  const collapsedByUser = new Map([
    ["pinned.ts", { collapsed: true, revision: 1 }],
  ]);
  const expandedByUser = new Map([
    ["pinned.ts", { collapsed: false, revision: 1 }],
  ]);

  it("无显式意图且无视图级缺省时不算用户折叠", () => {
    expect(isUserCollapsedItem("a.ts", new Map(), null)).toBe(false);
  });

  it("视图级「折叠全部」覆盖未表态的槽位", () => {
    expect(isUserCollapsedItem("a.ts", new Map(), true)).toBe(true);
  });

  it("视图级「展开全部」不算折叠", () => {
    expect(isUserCollapsedItem("a.ts", new Map(), false)).toBe(false);
  });

  it("显式 per-item 意图优先于视图级缺省", () => {
    expect(isUserCollapsedItem("pinned.ts", expandedByUser, true)).toBe(false);
    expect(isUserCollapsedItem("pinned.ts", collapsedByUser, false)).toBe(true);
  });
});

describe("syncRenderedEstimateSkeletons", () => {
  it("折叠全部时摘掉 estimate 槽的骨架，展开时装回", () => {
    const slot = mountSlot(true);
    syncEstimateSkeleton(slot, true);
    expect(hasSkeleton(slot)).toBe(true);

    syncRenderedEstimateSkeletons([slot], false);
    expect(hasSkeleton(slot)).toBe(false);

    syncRenderedEstimateSkeletons([slot], true);
    expect(hasSkeleton(slot)).toBe(true);
  });

  it("跳过非 estimate 槽，不误伤已水合的正文", () => {
    const loaded = mountSlot(false);
    syncRenderedEstimateSkeletons([loaded], true);
    expect(hasSkeleton(loaded)).toBe(false);
  });

  it("重复同步不叠加骨架节点", () => {
    const slot = mountSlot(true);
    syncRenderedEstimateSkeletons([slot], true);
    syncRenderedEstimateSkeletons([slot], true);
    expect(slot.shadowRoot?.querySelectorAll(SKELETON)).toHaveLength(1);
  });
});

describe("resolveItemVirtualHeight（geometry 单源）", () => {
  it("estimate 未用户折叠 → 骨架槽高", () => {
    expect(
      resolveItemVirtualHeight({
        collapsed: true,
        isEstimate: true,
        metrics: METRICS,
        userCollapsed: false,
      })
    ).toBe(METRICS.skeletonSlotHeight);
  });

  it("estimate 用户折叠 → header 高", () => {
    expect(
      resolveItemVirtualHeight({
        collapsed: true,
        isEstimate: true,
        metrics: METRICS,
        userCollapsed: true,
      })
    ).toBe(METRICS.headerHeight);
  });

  it("loaded 折叠 → 强制 header，清掉滞留正文高", () => {
    expect(
      resolveItemVirtualHeight({
        collapsed: true,
        isEstimate: false,
        metrics: METRICS,
        userCollapsed: false,
      })
    ).toBe(METRICS.headerHeight);
  });

  it("折叠全部缺省经 userCollapsed 钉 header；显式展开不得被压回", () => {
    // isUserCollapsedItem：无 per-item + collapseAll → userCollapsed true
    expect(
      resolveItemVirtualHeight({
        collapsed: false,
        isEstimate: false,
        metrics: METRICS,
        userCollapsed: true,
      })
    ).toBe(METRICS.headerHeight);
    // 用户点开单文件：userCollapsed false，不得钉 header
    expect(
      resolveItemVirtualHeight({
        collapsed: false,
        isEstimate: false,
        metrics: METRICS,
        userCollapsed: false,
      })
    ).toBeNull();
  });

  it("loaded 展开且无用户折叠意图 → 不覆盖 Pierre 正文高", () => {
    expect(
      resolveItemVirtualHeight({
        collapsed: false,
        isEstimate: false,
        metrics: METRICS,
        userCollapsed: false,
      })
    ).toBeNull();
  });
});

describe("applyDiffVirtualHeights 显式展开", () => {
  it("折叠全部后展开单槽：不把 collapsed 写回 true，高度交给正文", () => {
    const headerHeight = METRICS.headerHeight;
    const loaded = {
      height: headerHeight,
      instance: {
        currentCollapsed: true,
        height: headerHeight,
        layoutDirty: false,
        top: 0,
      },
      item: {
        collapsed: false,
        fileDiff: { cacheKey: "loaded:a" },
        id: "a",
      },
      top: 0,
      type: "diff",
    };
    const stillCollapsed = {
      height: 400,
      instance: {
        currentCollapsed: false,
        height: 400,
        layoutDirty: false,
        top: headerHeight,
      },
      item: {
        collapsed: true,
        fileDiff: { cacheKey: "loaded:b" },
        id: "b",
      },
      top: headerHeight,
      type: "diff",
    };
    const codeView = {
      container: document.createElement("div"),
      containerHeight: -1,
      getLayout: () => ({ gap: 0, paddingTop: 0 }),
      items: [loaded, stillCollapsed],
      scrollDirty: false,
      scrollHeight: 0,
    };
    applyDiffVirtualHeights(codeView, {
      isCollapseAllIntent: () => true,
      isUserCollapsed: (id) => id !== "a",
      metrics: METRICS,
    });
    expect(loaded.item?.collapsed).toBe(false);
    expect(loaded.instance.currentCollapsed).toBe(false);
    expect(loaded.instance.layoutDirty).toBe(true);
    expect(stillCollapsed.height).toBe(headerHeight);
    expect(stillCollapsed.item?.collapsed).toBe(true);
    expect(stillCollapsed.instance.currentCollapsed).toBe(true);
  });
});

describe("applyDiffVirtualHeights", () => {
  it("estimate 抬到骨架槽高；展开 loaded 保持正文高", () => {
    const headerHeight = METRICS.headerHeight;
    const skeleton = METRICS.skeletonSlotHeight;
    const gap = METRICS.gap;
    const estimateA = {
      height: headerHeight,
      instance: { height: headerHeight, top: 0 },
      item: {
        collapsed: true,
        fileDiff: { cacheKey: "estimate:a" },
        id: "a",
      },
      top: 0,
      type: "diff",
    };
    const estimateB = {
      height: headerHeight,
      instance: { height: headerHeight, top: headerHeight + gap },
      item: {
        collapsed: true,
        fileDiff: { cacheKey: "estimate:b" },
        id: "b",
      },
      top: headerHeight + gap,
      type: "diff",
    };
    const loaded = {
      height: 200,
      instance: { height: 200, top: 0 },
      item: {
        collapsed: false,
        fileDiff: { cacheKey: "loaded:c" },
        id: "c",
      },
      top: 0,
      type: "diff",
    };
    const container = document.createElement("div");
    const codeView = {
      container,
      containerHeight: -1,
      getLayout: () => ({ gap, paddingTop: 0 }),
      items: [estimateA, estimateB, loaded],
      scrollDirty: false,
      scrollHeight: 0,
    };

    const changed = applyDiffVirtualHeights(codeView, {
      isUserCollapsed: () => false,
      metrics: METRICS,
    });

    expect(changed).toBe(true);
    expect(estimateA.height).toBe(skeleton);
    expect(estimateB.height).toBe(skeleton);
    expect(loaded.height).toBe(200);
    expect(estimateA.top).toBe(0);
    expect(estimateB.top).toBe(skeleton + gap);
    expect(loaded.top).toBe(skeleton + gap + skeleton + gap);
    expect(codeView.scrollHeight).toBe(loaded.top + loaded.height);
    expect(container.style.height).toBe(`${codeView.scrollHeight}px`);
  });

  it("用户折叠后 estimate 与 loaded 都回到 header 高（清虚高）", () => {
    const headerHeight = METRICS.headerHeight;
    const skeleton = METRICS.skeletonSlotHeight;
    const estimate = {
      height: skeleton,
      instance: { height: skeleton, top: 0 },
      item: {
        collapsed: true,
        fileDiff: { cacheKey: "estimate:a" },
        id: "a",
      },
      top: 0,
      type: "diff",
    };
    const loadedCollapsed = {
      height: 480,
      instance: { height: 480, top: skeleton },
      item: {
        collapsed: true,
        fileDiff: { cacheKey: "loaded:b" },
        id: "b",
      },
      top: skeleton,
      type: "diff",
    };
    const codeView = {
      container: document.createElement("div"),
      containerHeight: -1,
      getLayout: () => ({ gap: 0, paddingTop: 0 }),
      items: [estimate, loadedCollapsed],
      scrollDirty: false,
      scrollHeight: skeleton + 480,
    };

    applyDiffVirtualHeights(codeView, {
      isUserCollapsed: () => true,
      metrics: METRICS,
    });

    expect(estimate.height).toBe(headerHeight);
    expect(loadedCollapsed.height).toBe(headerHeight);
    expect(loadedCollapsed.top).toBe(headerHeight);
    expect(codeView.scrollHeight).toBe(headerHeight * 2);
  });

  it("识别 estimate cacheKey 前缀", () => {
    expect(isEstimateCacheKey("estimate:x")).toBe(true);
    expect(isEstimateCacheKey("loaded:x")).toBe(false);
    expect(isEstimateCacheKey(undefined)).toBe(false);
  });

  it("A1: 折叠全部后 pin 总高 = n × header（不滚动即正确）", () => {
    const headerHeight = METRICS.headerHeight;
    const gap = METRICS.gap;
    const n = 40;
    const items = Array.from({ length: n }, (_, index) => {
      // 模拟：可见区已是 header，窗外项 virtual height 仍滞留正文高
      const staleHeight = index < 8 ? headerHeight : 200 + (index % 5) * 40;
      return {
        height: staleHeight,
        instance: { height: staleHeight, top: 0 },
        item: {
          collapsed: index < 8,
          fileDiff: { cacheKey: `loaded:f${index}.ts` },
          id: `f${index}.ts`,
        },
        top: 0,
        type: "diff" as const,
      };
    });
    const container = document.createElement("div");
    const codeView = {
      container,
      containerHeight: 99_999,
      getLayout: () => ({ gap, paddingTop: 0 }),
      items,
      scrollDirty: false,
      scrollHeight: 99_999,
    };

    // 折叠全部意图：即使 item.collapsed 尚未写上，也全表 header
    applyDiffVirtualHeights(codeView, {
      isCollapseAllIntent: () => true,
      isUserCollapsed: () => true,
      metrics: METRICS,
    });
    pinCodeViewScrollHeight(codeView, gap);

    const expected = n * headerHeight + (n - 1) * gap;
    expect(items.every((item) => item.height === headerHeight)).toBe(true);
    expect(items.every((item) => item.item?.collapsed === true)).toBe(true);
    expect(codeView.scrollHeight).toBe(expected);
    expect(container.style.height).toBe(`${expected}px`);
    expect(700 / codeView.scrollHeight).toBeGreaterThan(0.4);
  });
});
