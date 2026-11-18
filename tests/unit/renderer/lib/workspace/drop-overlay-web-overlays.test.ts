import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachWorkspaceDropOverlayWebOverlays } from "@/lib/workspace/drop-overlay-web-overlays.ts";
import { getLastTerminalHostSnapshot } from "@/lib/workspace/terminal-host-state-reconciler.ts";
import {
  getTerminalFocusRoutingDebugSnapshot,
  resetTerminalInputRoutingForTests,
} from "@/stores/terminal-input-routing-slice.ts";

class ResizeObserverMock {
  disconnect(): void {
    // Test polyfill no-op.
  }
  observe(): void {
    // Test polyfill no-op.
  }
  unobserve(): void {
    // Test polyfill no-op.
  }
}

interface RectInput {
  height: number;
  width: number;
  x: number;
  y: number;
}

function setRect(element: HTMLElement, rect: RectInput): void {
  element.getBoundingClientRect = () =>
    ({
      bottom: rect.y + rect.height,
      height: rect.height,
      left: rect.x,
      right: rect.x + rect.width,
      toJSON: () => ({}),
      top: rect.y,
      width: rect.width,
      x: rect.x,
      y: rect.y,
    }) as DOMRect;
}

function makeDropAnchor(rect: RectInput): {
  anchor: HTMLElement;
  container: HTMLElement;
} {
  const container = document.createElement("div");
  container.className = "dv-drop-target-container";
  const anchor = document.createElement("div");
  anchor.className = "dv-drop-target-anchor";
  setRect(anchor, rect);
  anchor.style.backgroundColor = "rgba(38, 160, 218, 0.1)";
  anchor.style.borderWidth = "1px";
  anchor.style.borderStyle = "solid";
  anchor.style.borderColor = "rgba(38, 160, 218, 0.55)";
  container.append(anchor);
  return { anchor, container };
}

let animationFrames: FrameRequestCallback[] = [];

function flushAnimationFrames(): void {
  const pending = animationFrames;
  animationFrames = [];
  for (const callback of pending) {
    callback(performance.now());
  }
}

async function settle(): Promise<void> {
  await Promise.resolve();
  flushAnimationFrames();
}

async function settleMutations(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function overlayRects() {
  return getLastTerminalHostSnapshot()?.webOverlayRects ?? [];
}

describe("workspace drop overlay web overlays", () => {
  beforeEach(() => {
    resetTerminalInputRoutingForTests();
    animationFrames = [];
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback): number => {
        animationFrames.push(callback);
        return animationFrames.length;
      }
    );
    vi.stubGlobal("cancelAnimationFrame", (): void => {
      animationFrames = [];
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: { applyHostSnapshot: vi.fn() },
        window: { onLayoutPulse: vi.fn(() => vi.fn()) },
      },
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("registers dockview drop anchors as translucent scrims with a border", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const { container } = makeDropAnchor({
      height: 300,
      width: 400,
      x: 100,
      y: 40,
    });
    root.append(container);

    const cleanup = attachWorkspaceDropOverlayWebOverlays(root);

    const rect = overlayRects()[0];
    expect(rect).toBeDefined();
    expect(rect?.id).toMatch(/^dockview-drop-overlay:/);
    expect(rect?.paints).toBe(false);
    expect(rect?.frame).toEqual({ height: 300, width: 400, x: 100, y: 40 });
    expect(rect?.scrim?.a).toBeCloseTo(0.1);
    expect(rect?.scrimBorder?.width).toBe(1);
    expect(rect?.scrimBorder?.color.a).toBeCloseTo(0.55);
    expect(
      getTerminalFocusRoutingDebugSnapshot().webOverlayIds.some((id) =>
        id.startsWith("dockview-drop-overlay:")
      )
    ).toBe(true);

    cleanup();
    root.remove();
    expect(overlayRects()).toHaveLength(0);
  });

  it("re-registers when dockview replaces the anchor", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const first = makeDropAnchor({ height: 200, width: 300, x: 0, y: 0 });
    root.append(first.container);
    const cleanup = attachWorkspaceDropOverlayWebOverlays(root);
    expect(overlayRects()).toHaveLength(1);

    first.anchor.remove();
    // 同拍清理：mutation 回调里直接 dispose，不需要等 rAF。
    await settleMutations();
    expect(overlayRects()).toHaveLength(0);

    const second = makeDropAnchor({ height: 100, width: 150, x: 20, y: 30 });
    root.append(second.container);
    await settle();
    expect(overlayRects()).toHaveLength(1);
    expect(overlayRects()[0]?.frame).toEqual({
      height: 100,
      width: 150,
      x: 20,
      y: 30,
    });

    cleanup();
    root.remove();
  });

  it("follows the anchor's geometry transition frame by frame", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const { anchor, container } = makeDropAnchor({
      height: 300,
      width: 400,
      x: 0,
      y: 0,
    });
    root.append(container);
    const cleanup = attachWorkspaceDropOverlayWebOverlays(root);

    let moving = true;
    let animationReads = 0;
    anchor.getAnimations = () => {
      animationReads += 1;
      return (moving
        ? [
            {
              playState: "running",
              transitionProperty: "top",
            },
          ]
        : []) as unknown as Animation[];
    };

    // 不写 style，只改几何并派发 transitionstart：验证 follow 链本身，
    // 而不是让 style MutationObserver 的普通 sync 把断言蒙过去。
    const firstRect = { height: 300, width: 400, x: 0, y: 200 };
    setRect(anchor, firstRect);
    anchor.dispatchEvent(new Event("transitionstart"));
    flushAnimationFrames();
    expect(overlayRects()[0]?.frame).toEqual(firstRect);
    expect(animationReads).toBeGreaterThan(0);

    // 下一帧几何继续变化，follow 链应读取新矩形，而不是停在首帧。
    const secondRect = { height: 300, width: 400, x: 0, y: 280 };
    setRect(anchor, secondRect);
    flushAnimationFrames();
    expect(overlayRects()[0]?.frame).toEqual(secondRect);

    moving = false;
    flushAnimationFrames();

    cleanup();
    root.remove();
    expect(overlayRects()).toHaveLength(0);
  });
});
