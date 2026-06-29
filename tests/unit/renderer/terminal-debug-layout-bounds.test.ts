import type { TerminalWebOverlayRect } from "@shared/contracts/terminal.ts";
import { describe, expect, it } from "vitest";
import { mergedLayoutBounds } from "@/components/common/terminal-debug-layout-view.tsx";

const base = { height: 100, width: 200, x: 0, y: 0 };

function overlay(
  id: string,
  frame: TerminalWebOverlayRect["frame"]
): TerminalWebOverlayRect {
  return { frame, id };
}

describe("mergedLayoutBounds", () => {
  it("returns the base bounds untouched when there are no overlays", () => {
    expect(mergedLayoutBounds(base, [])).toEqual(base);
  });

  it("returns null when there is no base and no overlays", () => {
    expect(mergedLayoutBounds(null, [])).toBeNull();
  });

  it("expands the bounds to cover an overlay that sticks out", () => {
    const rect = overlay("ov-1", { height: 40, width: 60, x: 180, y: -10 });
    expect(mergedLayoutBounds(base, [rect])).toEqual({
      height: 110,
      width: 240,
      x: 0,
      y: -10,
    });
  });

  it("derives bounds from overlays alone when base is null", () => {
    const rect = overlay("ov-2", { height: 20, width: 30, x: 5, y: 5 });
    expect(mergedLayoutBounds(null, [rect])).toEqual({
      height: 20,
      width: 30,
      x: 5,
      y: 5,
    });
  });
});
