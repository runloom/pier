import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachWorkspaceSashWebOverlays } from "@/lib/workspace/sash-web-overlays.ts";
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

function makeSash(rect: RectInput): HTMLElement {
  const element = document.createElement("div");
  element.className = "dv-sash";
  setRect(element, rect);
  return element;
}

function setVisible(element: HTMLElement, visible: boolean): void {
  element.getClientRects = () =>
    (visible
      ? [element.getBoundingClientRect()]
      : []) as unknown as DOMRectList;
}

interface FloatingGroupFixture {
  container: HTMLElement;
  content: HTMLElement;
  tabs: HTMLElement;
  terminal: HTMLElement;
  titlebar: HTMLElement;
}

function makeFloatingGroup(
  containerRect: RectInput,
  terminalVisible: boolean
): FloatingGroupFixture {
  const container = document.createElement("div");
  container.className = "dv-resize-container";
  setRect(container, containerRect);

  const titlebar = document.createElement("div");
  titlebar.className = "dv-floating-titlebar dv-draggable";
  setRect(titlebar, {
    height: 22,
    width: containerRect.width,
    x: containerRect.x,
    y: containerRect.y,
  });

  const tabs = document.createElement("div");
  tabs.className = "dv-tabs-and-actions-container";
  setRect(tabs, {
    height: 34,
    width: containerRect.width,
    x: containerRect.x,
    y: containerRect.y + 22,
  });

  const content = document.createElement("div");
  content.className = "dv-content-container";
  setRect(content, {
    height: containerRect.height - 56,
    width: containerRect.width,
    x: containerRect.x,
    y: containerRect.y + 56,
  });

  const terminal = document.createElement("div");
  terminal.setAttribute("data-testid", "terminal-panel-root");
  setRect(terminal, {
    height: containerRect.height - 56,
    width: containerRect.width,
    x: containerRect.x,
    y: containerRect.y + 56,
  });
  setVisible(terminal, terminalVisible);
  content.append(terminal);
  container.append(titlebar, tabs, content);

  return { container, content, tabs, terminal, titlebar };
}

interface LayoutChangeSourceStub {
  activeDispose: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  fire(): void;
  fireActive(): void;
  onDidActivePanelChange(listener: () => void): { dispose(): void };
  onDidLayoutChange(listener: () => void): { dispose(): void };
}

function makeLayoutChangeSource(): LayoutChangeSourceStub {
  let listener: (() => void) | null = null;
  let activeListener: (() => void) | null = null;
  const dispose = vi.fn();
  const activeDispose = vi.fn();
  return {
    activeDispose,
    dispose,
    fire() {
      listener?.();
    },
    fireActive() {
      activeListener?.();
    },
    onDidActivePanelChange(next) {
      activeListener = next;
      return { dispose: activeDispose };
    },
    onDidLayoutChange(next) {
      listener = next;
      return { dispose };
    },
  };
}

let animationFrames: FrameRequestCallback[] = [];

function flushAnimationFrames(): void {
  const pending = animationFrames;
  animationFrames = [];
  for (const callback of pending) {
    callback(performance.now());
  }
}

function overlayRects() {
  return getLastTerminalHostSnapshot()?.webOverlayRects ?? [];
}

function overlayIds(): string[] {
  return getTerminalFocusRoutingDebugSnapshot().webOverlayIds;
}

describe("workspace sash web overlays", () => {
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
    vi.unstubAllGlobals();
  });

  it("registers every dockview sash over the workspace root", () => {
    const root = document.createElement("div");
    root.append(
      makeSash({ height: 500, width: 5, x: 400, y: 40 }),
      makeSash({ height: 5, width: 800, x: 0, y: 300 })
    );

    const cleanup = attachWorkspaceSashWebOverlays(
      root,
      makeLayoutChangeSource()
    );

    expect(overlayRects()).toHaveLength(2);
    expect(overlayIds().every((id) => id.startsWith("dockview-sash:"))).toBe(
      true
    );
    expect(overlayRects().map((entry) => entry.frame)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ height: 500, width: 5, x: 400, y: 40 }),
        expect.objectContaining({ height: 5, width: 800, x: 0, y: 300 }),
      ])
    );

    cleanup();
    expect(overlayRects()).toHaveLength(0);
    expect(overlayIds()).toHaveLength(0);
  });

  it("reconciles sashes added or removed by a layout change", () => {
    const root = document.createElement("div");
    const first = makeSash({ height: 500, width: 5, x: 400, y: 40 });
    root.append(first);
    const layout = makeLayoutChangeSource();
    const cleanup = attachWorkspaceSashWebOverlays(root, layout);

    const firstIds = overlayIds();
    expect(firstIds).toHaveLength(1);

    const second = makeSash({ height: 500, width: 5, x: 800, y: 40 });
    root.append(second);
    layout.fire();
    flushAnimationFrames();
    expect(overlayRects()).toHaveLength(2);

    first.remove();
    layout.fire();
    flushAnimationFrames();
    expect(overlayRects()).toHaveLength(1);
    expect(overlayIds()).not.toContain(firstIds[0]);

    cleanup();
  });

  it("refreshes geometry when dockview rewrites the sash inline style", async () => {
    const root = document.createElement("div");
    const sash = makeSash({ height: 500, width: 5, x: 400, y: 40 });
    root.append(sash);
    const cleanup = attachWorkspaceSashWebOverlays(
      root,
      makeLayoutChangeSource()
    );
    expect(overlayRects()[0]?.frame.x).toBe(400);

    setRect(sash, { height: 500, width: 5, x: 520, y: 40 });
    sash.style.left = "520px";
    // jsdom 的 MutationObserver 回调在微任务里派发。
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushAnimationFrames();

    expect(overlayRects()[0]?.frame.x).toBe(520);
    cleanup();
  });

  it("registers the whole floating group when it holds no visible terminal", () => {
    const root = document.createElement("div");
    const group = makeFloatingGroup(
      { height: 300, width: 300, x: 120, y: 90 },
      false
    );
    root.append(group.container);

    const cleanup = attachWorkspaceSashWebOverlays(
      root,
      makeLayoutChangeSource()
    );

    expect(overlayRects()).toEqual([
      expect.objectContaining({
        frame: expect.objectContaining({
          height: 300,
          width: 300,
          x: 120,
          y: 90,
        }),
        id: expect.stringMatching(/^dockview-floating-container:/),
      }),
    ]);
    cleanup();
  });

  it("registers only chrome parts when a floating group holds a visible terminal", () => {
    const root = document.createElement("div");
    const group = makeFloatingGroup(
      { height: 300, width: 300, x: 120, y: 90 },
      true
    );
    // 同一浮组网格里的非终端 content 区仍必须回填。
    const webContent = document.createElement("div");
    webContent.className = "dv-content-container";
    const webRect = { height: 120, width: 300, x: 120, y: 300 };
    setRect(webContent, webRect);
    group.container.append(webContent);
    root.append(group.container);

    const cleanup = attachWorkspaceSashWebOverlays(
      root,
      makeLayoutChangeSource()
    );

    const ids = overlayIds();
    expect(ids.some((id) => id.startsWith("dockview-floating-titlebar:"))).toBe(
      true
    );
    expect(ids.some((id) => id.startsWith("dockview-group-tabs:"))).toBe(true);
    expect(
      ids.some((id) => id.startsWith("dockview-floating-container:"))
    ).toBe(false);

    const frames = overlayRects().map((entry) => entry.frame);
    // 终端 body 与浮组外框都不得整块回填，否则终端自己的洞会被抹掉。
    expect(frames).not.toContainEqual(
      expect.objectContaining({ height: 244, width: 300, x: 120, y: 146 })
    );
    expect(frames).not.toContainEqual(
      expect.objectContaining({ height: 300, width: 300, x: 120, y: 90 })
    );
    expect(frames).toContainEqual(expect.objectContaining(webRect));
    cleanup();
  });

  it("resyncs floating-group chrome when the active panel changes", () => {
    const root = document.createElement("div");
    const group = makeFloatingGroup(
      { height: 300, width: 300, x: 120, y: 90 },
      false
    );
    root.append(group.container);
    const layout = makeLayoutChangeSource();
    const cleanup = attachWorkspaceSashWebOverlays(root, layout);

    expect(overlayRects()).toHaveLength(1);

    // 切到终端 tab：可见终端出现，整块浮组必须让位给终端洞。
    setVisible(group.terminal, true);
    layout.fireActive();
    flushAnimationFrames();

    expect(overlayRects().map((entry) => entry.id)).not.toContainEqual(
      expect.stringMatching(/^dockview-floating-container:/)
    );

    // 切回非终端 tab：整块浮组重新回填。
    setVisible(group.terminal, false);
    layout.fireActive();
    flushAnimationFrames();

    expect(overlayRects()).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^dockview-floating-container:/),
      }),
    ]);
    cleanup();
  });

  it("disposes layout subscription and every registration", () => {
    const root = document.createElement("div");
    root.append(makeSash({ height: 500, width: 5, x: 400, y: 40 }));
    const layout = makeLayoutChangeSource();
    const cleanup = attachWorkspaceSashWebOverlays(root, layout);

    cleanup();

    expect(layout.dispose).toHaveBeenCalledTimes(1);
    expect(overlayRects()).toHaveLength(0);

    root.append(makeSash({ height: 500, width: 5, x: 700, y: 40 }));
    layout.fire();
    flushAnimationFrames();
    expect(overlayRects()).toHaveLength(0);
  });
});
