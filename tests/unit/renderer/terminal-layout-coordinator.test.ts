import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readTerminalAnchorFrame,
  readTerminalViewportFrame,
  registerTerminalLayoutAnchor,
  setTerminalLayoutPresentationScheduler,
} from "@/panel-kits/terminal/terminal-layout-coordinator.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

class TestResizeObserver {
  observe() {
    // Test no-op.
  }
  disconnect() {
    // Test no-op.
  }
}

describe("terminal layout coordinator", () => {
  const originalInnerHeight = window.innerHeight;
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    useZoomStore.setState({ windowZoomLevel: 0 });
    window.localStorage.clear();
    globalThis.ResizeObserver =
      TestResizeObserver as unknown as typeof ResizeObserver;
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        onWindowLayoutPulse: (
          cb: (pulse: {
            reason: "resize" | "view-zoom" | "zoom";
            windowZoomLevel?: number;
          }) => void
        ) => {
          window.dispatchEvent(
            new CustomEvent("test-window-layout-pulse-subscriber", {
              detail: cb,
            })
          );
          return () => undefined;
        },
      },
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 800,
    });
  });

  afterEach(() => {
    useZoomStore.setState({ windowZoomLevel: 0 });
    window.localStorage.clear();
    Reflect.deleteProperty(window, "pier");
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
  });

  it("converts DOM anchor rects to native window points with the active window zoom", () => {
    const anchor = document.createElement("div");
    anchor.getBoundingClientRect = () =>
      ({
        bottom: 320,
        height: 300,
        left: 10,
        right: 410,
        top: 20,
        width: 400,
        x: 10,
        y: 20,
        toJSON: () => null,
      }) as DOMRect;
    useZoomStore.setState({ windowZoomLevel: 2 });

    expect(readTerminalAnchorFrame(anchor)).toEqual({
      height: 432,
      width: 576,
      x: 14.4,
      y: 28.8,
    });
  });

  it("reports the renderer viewport in the same native point coordinate space", () => {
    useZoomStore.setState({ windowZoomLevel: -1 });

    expect(readTerminalViewportFrame()).toEqual({
      height: 500,
      width: 666.667,
      x: 0,
      y: 0,
    });
  });

  it("flushes registered terminal frames only after the window zoom layout pulse", () => {
    const anchor = document.createElement("div");
    anchor.getBoundingClientRect = () =>
      ({
        bottom: 320,
        height: 300,
        left: 10,
        right: 410,
        top: 20,
        width: 400,
        x: 10,
        y: 20,
        toJSON: () => null,
      }) as DOMRect;
    const reasons: string[] = [];
    const unsetScheduler = setTerminalLayoutPresentationScheduler((reason) => {
      reasons.push(reason);
    });
    const pulseSubscribers: Array<
      (pulse: {
        reason: "resize" | "view-zoom" | "zoom";
        windowZoomLevel?: number;
      }) => void
    > = [];
    window.addEventListener(
      "test-window-layout-pulse-subscriber",
      (event) => {
        pulseSubscribers.push((event as CustomEvent).detail);
      },
      { once: true }
    );
    const registration = registerTerminalLayoutAnchor("terminal-1", anchor);
    reasons.length = 0;

    useZoomStore.setState({ windowZoomLevel: 1 });

    expect(reasons).not.toContain("window-view-zoom");
    expect(pulseSubscribers).toHaveLength(1);

    pulseSubscribers[0]?.({ reason: "view-zoom", windowZoomLevel: 1 });

    expect(reasons).toContain("window-view-zoom");

    registration.dispose();
    unsetScheduler();
  });
});
