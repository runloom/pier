import { sourcePeekGeometry } from "@plugins/builtin/files/renderer/git-changes/source-layout.ts";
import { describe, expect, it } from "vitest";

const layout = {
  viewportLeft: 100,
  viewportRight: 1000,
  contentLeft: 160,
  paddingLeft: 8,
  gutterRight: 160,
  minimapLeft: 900,
  endInset: 16,
};

describe("source peek visible content bounds", () => {
  it("reserves the gap after accounting for the content's left padding", () => {
    const result = sourcePeekGeometry(layout);
    expect(result).toEqual({ left: 68, width: 716 });
    expect(100 + result.left + result.width).toBe(884);
  });

  it("keeps the peek in the visible code column while source scrolls horizontally", () => {
    expect(sourcePeekGeometry({ ...layout, contentLeft: -240 })).toEqual(
      sourcePeekGeometry(layout)
    );
  });

  it("uses the scroll viewport when minimap is hidden, including narrow spacing", () => {
    expect(
      sourcePeekGeometry({ ...layout, minimapLeft: null, endInset: 12 })
    ).toEqual({ left: 68, width: 820 });
  });

  it("does not enforce a minimum width that would overlap the minimap", () => {
    expect(sourcePeekGeometry({ ...layout, minimapLeft: 170 }).width).toBe(0);
  });

  it("converts transformed viewport coordinates back to editor layout pixels", () => {
    const result = sourcePeekGeometry({
      ...layout,
      viewportRight: 820,
      contentLeft: 148,
      gutterRight: 148,
      minimapLeft: 740,
      scaleX: 0.8,
    });
    expect(result.left).toBeCloseTo(68);
    expect(result.width).toBeCloseTo(716);
  });
});
