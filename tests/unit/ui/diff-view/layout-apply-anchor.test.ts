import { diffMetrics } from "@pier/ui/diff-view/geometry.ts";
import { captureDiffVirtualLayoutAnchor } from "@pier/ui/diff-view/item-anchor.ts";
import {
  applyDiffVirtualHeightsPreservingAnchor,
  reconcileDiffVirtualHeights,
} from "@pier/ui/diff-view/layout-apply.ts";
import { describe, expect, it } from "vitest";

interface LayoutItemFixture {
  height: number;
  instance: {
    currentCollapsed?: boolean;
    height: number;
    layoutDirty?: boolean;
    top: number;
  };
  item: {
    collapsed?: boolean;
    fileDiff?: { cacheKey?: string };
    id: string;
  };
  top: number;
  type: string;
}

interface ViewerFixture {
  getHeight: () => number;
  getLayout: () => { gap: number; paddingTop: number };
  getScrollTop: () => number;
  items: LayoutItemFixture[];
  pendingLayoutAnchor: unknown;
  pendingScrollTarget: unknown;
  render?: () => void;
  scrollAnimation: unknown;
  scrollHeight: number;
}

const METRICS = diffMetrics("13px");

function viewer(scrollTop = 0): ViewerFixture {
  return {
    getHeight: () => 600,
    getLayout: () => ({ gap: 1, paddingTop: 8 }),
    getScrollTop: () => scrollTop,
    items: [
      {
        height: 100,
        instance: { height: 100, top: 0 },
        item: { id: "a" },
        top: 0,
        type: "diff",
      },
      {
        height: 100,
        instance: { height: 100, top: 101 },
        item: { id: "b" },
        top: 101,
        type: "diff",
      },
    ],
    pendingLayoutAnchor: undefined,
    pendingScrollTarget: undefined,
    scrollAnimation: undefined,
    scrollHeight: 201,
  };
}

function options() {
  return {
    isUserCollapsed: () => false,
    metrics: METRICS,
  };
}

function growFirstItem(source: ViewerFixture): void {
  const first = source.items[0];
  const second = source.items[1];
  if (!(first && second)) {
    throw new Error("fixture missing items");
  }
  first.height = 300;
  first.instance.height = 300;
  first.top = 0;
  first.instance.top = 0;
  second.top = 301;
  second.instance.top = 301;
}

describe("applyDiffVirtualHeightsPreservingAnchor", () => {
  it("seeds the current top anchor after heights shift downward", () => {
    const source = viewer();
    expect(captureDiffVirtualLayoutAnchor(source)).toEqual({
      id: "a",
      viewportOffset: 8,
    });

    growFirstItem(source);
    const changed = applyDiffVirtualHeightsPreservingAnchor(source, options());

    expect(changed).toBe(true);
    expect(source.pendingLayoutAnchor).toEqual({
      id: "a",
      type: "item",
      viewportOffset: 8,
    });
  });

  it("does not seed when the layout did not change", () => {
    const source = viewer();

    expect(applyDiffVirtualHeightsPreservingAnchor(source, options())).toBe(
      false
    );
    expect(source.pendingLayoutAnchor).toBeUndefined();
  });

  it("does not seed while a pending target or animation owns the viewport", () => {
    for (const key of [
      "pendingScrollTarget",
      "scrollAnimation",
      "pendingLayoutAnchor",
    ] as const) {
      const source = viewer();
      source[key] = { id: "existing" };
      growFirstItem(source);

      expect(applyDiffVirtualHeightsPreservingAnchor(source, options())).toBe(
        true
      );
      expect(source[key]).toEqual({ id: "existing" });
    }
  });

  it("does not seed a hidden viewport", () => {
    const source = viewer();
    source.getHeight = () => 0;
    growFirstItem(source);

    expect(applyDiffVirtualHeightsPreservingAnchor(source, options())).toBe(
      true
    );
    expect(source.pendingLayoutAnchor).toBeUndefined();
  });

  it("returns false for a non-viewer source", () => {
    expect(applyDiffVirtualHeightsPreservingAnchor(null, options())).toBe(
      false
    );
  });

  it("keeps the target header within one pixel after preceding growth", () => {
    // 目标 b 已吸顶：scrollTop = paddingTop + b.top。
    const source = viewer(109);
    const anchor = captureDiffVirtualLayoutAnchor(source);
    expect(anchor).toEqual({ id: "b", viewportOffset: 0 });

    growFirstItem(source);
    expect(
      applyDiffVirtualHeightsPreservingAnchor(source, options(), anchor)
    ).toBe(true);
    const pending = source.pendingLayoutAnchor as {
      readonly id: string;
      readonly viewportOffset: number;
    };
    const b = source.items[1];
    if (!b) {
      throw new Error("fixture missing target item");
    }
    const nextScrollTop = 8 + b.top - pending.viewportOffset;
    const headerFlushPx = 8 + b.top - nextScrollTop;

    expect(pending.id).toBe("b");
    expect(Math.abs(headerFlushPx)).toBeLessThanOrEqual(1);
  });

  it("does not re-seed the pre-render anchor after render consumes it", () => {
    const source = viewer();
    growFirstItem(source);
    let rendered = false;
    source.render = () => {
      if (rendered) {
        return;
      }
      rendered = true;
      // 模拟 Pierre 在 render(true) 中消费锚点并再测一次布局。
      source.pendingLayoutAnchor = undefined;
      const second = source.items[1];
      if (!second) {
        throw new Error("fixture missing second item");
      }
      second.height = 180;
      second.instance.height = 180;
      second.top = 481;
      second.instance.top = 481;
    };

    reconcileDiffVirtualHeights(source, options());

    expect(rendered).toBe(true);
    expect(source.pendingLayoutAnchor).toBeUndefined();
  });
});
