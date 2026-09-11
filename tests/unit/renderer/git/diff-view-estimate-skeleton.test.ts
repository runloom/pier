import { isUserCollapsedItem } from "@pier/ui/diff-view/collapse-intent.ts";
import {
  PIER_DIFF_ESTIMATE_ATTR,
  syncEstimateSkeleton,
  syncRenderedEstimateSkeletons,
} from "@pier/ui/diff-view/estimate-skeleton.ts";
import { diffMetrics } from "@pier/ui/diff-view/geometry.ts";
import {
  applyDiffVirtualHeights,
  installDiffVirtualHeightReconciler,
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

describe("syncEstimateSkeleton", () => {
  const BARS = "[data-pier-estimate-skeleton-bar]";

  it("始终 5 条金标准图案，不按预留体铺条", () => {
    const slot = mountSlot(true);
    syncEstimateSkeleton(slot, true);
    expect(slot.shadowRoot?.querySelectorAll(BARS)).toHaveLength(5);
    expect(
      slot.shadowRoot?.querySelector("[data-pier-estimate-skeleton-fill]")
    ).toBeNull();
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

  it("estimate 带 numstat 仍是骨架槽，不拉高占位", () => {
    expect(
      resolveItemVirtualHeight({
        collapsed: false,
        contentLines: 40,
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

  it("estimate 即使带 estimatedContentLines 也只占骨架槽", () => {
    const estimate = {
      height: METRICS.headerHeight,
      instance: { height: METRICS.headerHeight, top: 0 },
      item: {
        collapsed: false,
        fileDiff: { cacheKey: "estimate:a", estimatedContentLines: 40 },
        id: "a",
      },
      top: 0,
      type: "diff",
    };
    applyDiffVirtualHeights(
      {
        container: document.createElement("div"),
        containerHeight: -1,
        getLayout: () => ({ gap: 0, paddingTop: 0 }),
        items: [estimate],
        scrollDirty: false,
        scrollHeight: 0,
      },
      {
        isUserCollapsed: () => false,
        metrics: METRICS,
      }
    );
    expect(estimate.height).toBe(METRICS.skeletonSlotHeight);
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

  it("pin 总值未变时不标脏", () => {
    const gap = METRICS.gap;
    const items = [
      {
        height: 40,
        instance: { height: 40, top: 0 },
        item: { id: "a", fileDiff: { cacheKey: "loaded:a" } },
        top: 0,
      },
      {
        height: 60,
        instance: { height: 60, top: 41 },
        item: { id: "b", fileDiff: { cacheKey: "estimate:b" } },
        top: 41,
      },
    ];
    const total = 40 + gap + 60;
    const container = document.createElement("div");
    container.style.height = `${total}px`;
    const codeView = {
      container,
      containerHeight: total,
      getLayout: () => ({ gap, paddingTop: 0 }),
      items,
      scrollDirty: false,
      scrollHeight: total,
    };
    expect(pinCodeViewScrollHeight(codeView, gap)).toBe(false);
    expect(codeView.scrollDirty).toBe(false);
  });

  it("普通滚动 emit 在总高被收成可见窗时 pin 回 Σ", () => {
    const gap = METRICS.gap;
    const items = [
      {
        height: 100,
        instance: { height: 100, top: 0 },
        item: { fileDiff: { cacheKey: "loaded:a" }, id: "a" },
        top: 0,
      },
      {
        height: 80,
        instance: { height: 80, top: 101 },
        item: { fileDiff: { cacheKey: "loaded:b" }, id: "b" },
        top: 101,
      },
    ];
    const total = 100 + gap + 80;
    const container = document.createElement("div");
    const codeView = {
      computeRenderRangeAndEmit: () => {
        codeView.containerHeight = 100;
        codeView.scrollHeight = 100;
        container.style.height = "100px";
      },
      container,
      containerHeight: total,
      getLayout: () => ({ gap, paddingTop: 0 }),
      items,
      recomputeLayout: () => undefined,
      scrollDirty: false,
      scrollHeight: total,
    };
    installDiffVirtualHeightReconciler(codeView, {
      current: {
        isCollapseAllIntent: () => false,
        isUserCollapsed: () => false,
        metrics: METRICS,
      },
    });
    codeView.computeRenderRangeAndEmit?.();
    expect(codeView.scrollHeight).toBe(total);
    expect(container.style.height).toBe(`${total}px`);
  });

  it("普通滚动 emit 在 syncContainerHeight 前 pin，scrollTop 不被同一拍 clamp", () => {
    const gap = METRICS.gap;
    const items = [
      {
        height: 100,
        instance: { height: 100, top: 0 },
        item: { fileDiff: { cacheKey: "loaded:a" }, id: "a" },
        top: 0,
      },
      {
        height: 80,
        instance: { height: 80, top: 101 },
        item: { fileDiff: { cacheKey: "loaded:b" }, id: "b" },
        top: 101,
      },
    ];
    const total = 100 + gap + 80;
    const container = document.createElement("div");
    const scroller = document.createElement("div");
    scroller.scrollTop = 120;
    const codeView = {
      computeRenderRangeAndEmit: () => {
        codeView.scrollHeight = 100;
        codeView.syncContainerHeight?.();
        const maxScrollTop = Math.max(codeView.scrollHeight - 50, 0);
        if (scroller.scrollTop > maxScrollTop) {
          scroller.scrollTop = 0;
        }
      },
      container,
      containerHeight: total,
      getLayout: () => ({ gap, paddingTop: 0 }),
      getPagedScrollHeight: () => codeView.scrollHeight,
      items,
      recomputeLayout: () => undefined,
      scrollDirty: false,
      scrollHeight: total,
      syncContainerHeight: () => {
        container.style.height = `${codeView.scrollHeight}px`;
        codeView.containerHeight = codeView.scrollHeight;
      },
    };
    installDiffVirtualHeightReconciler(codeView, {
      current: {
        isCollapseAllIntent: () => false,
        isUserCollapsed: () => false,
        metrics: METRICS,
      },
    });
    scroller.scrollTop = 120;
    codeView.computeRenderRangeAndEmit?.();
    expect(codeView.scrollHeight).toBe(total);
    expect(container.style.height).toBe(`${total}px`);
    expect(scroller.scrollTop).toBe(120);
  });

  it("pin 逻辑总高已是 Σ 且容器已是分页值时不标脏", () => {
    const gap = METRICS.gap;
    const total = 20_000_000;
    const paged = 12_000_000;
    const items = [
      {
        height: total,
        instance: { height: total, top: 0 },
        item: { fileDiff: { cacheKey: "loaded:a" }, id: "a" },
        top: 0,
      },
    ];
    const container = document.createElement("div");
    container.style.height = `${paged}px`;
    const codeView = {
      container,
      containerHeight: paged,
      getLayout: () => ({ gap, paddingTop: 0 }),
      getPagedScrollHeight: () => paged,
      items,
      scrollDirty: false,
      scrollHeight: total,
    };
    expect(pinCodeViewScrollHeight(codeView, gap)).toBe(false);
    expect(codeView.scrollDirty).toBe(false);
    expect(codeView.scrollHeight).toBe(total);
    expect(container.style.height).toBe(`${paged}px`);
  });

  it("pin 只改分页容器高时不标脏", () => {
    const gap = METRICS.gap;
    const total = 20_000_000;
    const paged = 12_000_000;
    const items = [
      {
        height: total,
        instance: { height: total, top: 0 },
        item: { fileDiff: { cacheKey: "loaded:a" }, id: "a" },
        top: 0,
      },
    ];
    const container = document.createElement("div");
    container.style.height = `${total}px`;
    const codeView = {
      container,
      containerHeight: total,
      getLayout: () => ({ gap, paddingTop: 0 }),
      getPagedScrollHeight: () => paged,
      items,
      scrollDirty: false,
      scrollHeight: total,
    };
    expect(pinCodeViewScrollHeight(codeView, gap)).toBe(true);
    expect(codeView.scrollDirty).toBe(false);
    expect(codeView.scrollHeight).toBe(total);
    expect(codeView.containerHeight).toBe(paged);
    expect(container.style.height).toBe(`${paged}px`);
  });

  it("无 getPagedScrollHeight 时超分页阈值的容器用 12e6", () => {
    const gap = METRICS.gap;
    const total = 20_000_000;
    const items = [
      {
        height: total,
        instance: { height: total, top: 0 },
        item: { fileDiff: { cacheKey: "loaded:a" }, id: "a" },
        top: 0,
      },
    ];
    const container = document.createElement("div");
    container.style.height = `${total}px`;
    const codeView = {
      container,
      containerHeight: total,
      getHeight: () => 0,
      getLayout: () => ({ gap, paddingBottom: 0, paddingTop: 0 }),
      items,
      scrollDirty: false,
      scrollHeight: total,
    };
    expect(pinCodeViewScrollHeight(codeView, gap)).toBe(true);
    expect(codeView.scrollDirty).toBe(false);
    expect(codeView.scrollHeight).toBe(total);
    expect(codeView.containerHeight).toBe(12_000_000);
  });
});
