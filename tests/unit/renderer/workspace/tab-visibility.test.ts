import { describe, expect, it } from "vitest";
import { revealElementWithinScrollContainer } from "@/lib/workspace/tab-visibility.ts";

function setRect(
  element: HTMLElement,
  rect: Pick<DOMRect, "bottom" | "left" | "right" | "top">
): void {
  element.getBoundingClientRect = () =>
    ({
      bottom: rect.bottom,
      height: rect.bottom - rect.top,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.right - rect.left,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe("workspace tab visibility", () => {
  it("scrolls right when the active tab is hidden behind header actions", () => {
    const container = document.createElement("div");
    const tab = document.createElement("div");
    container.scrollLeft = 0;
    setRect(container, { bottom: 34, left: 0, right: 200, top: 0 });
    setRect(tab, { bottom: 34, left: 160, right: 260, top: 0 });

    revealElementWithinScrollContainer(container, tab);

    expect(container.scrollLeft).toBe(68);
    expect(container.scrollTop).toBe(0);
  });

  it("scrolls left when the active tab is before the visible range", () => {
    const container = document.createElement("div");
    const tab = document.createElement("div");
    container.scrollLeft = 120;
    setRect(container, { bottom: 34, left: 100, right: 300, top: 0 });
    setRect(tab, { bottom: 34, left: 80, right: 140, top: 0 });

    revealElementWithinScrollContainer(container, tab);

    expect(container.scrollLeft).toBe(92);
  });
});
