import {
  fileTreeScrollElementFromNode,
  pinFileTreeScrollDuringContextMenu,
} from "@pier/ui/file-tree-scroll.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("file-tree context-menu scroll pin", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "queueMicrotask"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves the virtualized scroller from a shadow-tree anchor", () => {
    const host = document.createElement("file-tree-container");
    host.setAttribute("data-slot", "pier-file-tree");
    const shadow = host.attachShadow({ mode: "open" });
    const scroller = document.createElement("div");
    scroller.setAttribute("data-file-tree-virtualized-scroll", "true");
    const anchor = document.createElement("button");
    scroller.append(anchor);
    shadow.append(scroller);
    document.body.append(host);

    expect(fileTreeScrollElementFromNode(anchor)).toBe(scroller);
    host.remove();
  });

  it("restores scrollTop after layout-effect jostle (microtask + frames)", () => {
    const host = document.createElement("file-tree-container");
    host.setAttribute("data-slot", "pier-file-tree");
    const shadow = host.attachShadow({ mode: "open" });
    const scroller = document.createElement("div");
    scroller.setAttribute("data-file-tree-virtualized-scroll", "true");
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      value: 240,
      writable: true,
    });
    const anchor = document.createElement("button");
    scroller.append(anchor);
    shadow.append(scroller);
    document.body.append(host);

    pinFileTreeScrollDuringContextMenu(anchor);

    // Simulate pierre focus layout effect mutating scroll after onOpen.
    scroller.scrollTop = 180;
    expect(scroller.scrollTop).toBe(180);

    vi.runAllTicks();
    expect(scroller.scrollTop).toBe(240);

    scroller.scrollTop = 100;
    // Two rAF restores cover close()-triggered re-renders.
    vi.advanceTimersToNextFrame();
    expect(scroller.scrollTop).toBe(240);
    scroller.scrollTop = 50;
    vi.advanceTimersToNextFrame();
    expect(scroller.scrollTop).toBe(240);

    host.remove();
  });
});
