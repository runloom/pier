import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abortScheduledDockviewTabReveal,
  revealElementWithinScrollContainer,
  scheduleRevealDockviewTabByPanelId,
} from "@/lib/workspace/tab-visibility.ts";

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

function mountTab(
  panelId: string,
  tabRect: {
    bottom: number;
    left: number;
    right: number;
    top: number;
  }
): HTMLElement {
  const root = document.createElement("div");
  const tabsContainer = document.createElement("div");
  const tab = document.createElement("div");
  const content = document.createElement("div");
  tabsContainer.className = "dv-tabs-container";
  tab.className = "dv-tab";
  content.dataset.panelTabId = panelId;
  tab.append(content);
  tabsContainer.append(tab);
  root.append(tabsContainer);
  document.body.append(root);
  tabsContainer.scrollLeft = 0;
  setRect(tabsContainer, { bottom: 34, left: 0, right: 120, top: 0 });
  setRect(tab, tabRect);
  return root;
}

describe("scheduleRevealDockviewTabByPanelId settle", () => {
  afterEach(() => {
    abortScheduledDockviewTabReveal();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("reveals immediately when the tab is already laid out", () => {
    const root = mountTab("panel-1", {
      bottom: 34,
      left: 120,
      right: 200,
      top: 0,
    });

    scheduleRevealDockviewTabByPanelId("panel-1", root);

    expect(root.querySelector(".dv-tabs-container")?.scrollLeft).toBe(88);
  });

  it("does not scroll when the tab is already fully visible", () => {
    const root = mountTab("panel-1", {
      bottom: 34,
      left: 10,
      right: 80,
      top: 0,
    });

    scheduleRevealDockviewTabByPanelId("panel-1", root);

    expect(root.querySelector(".dv-tabs-container")?.scrollLeft).toBe(0);
  });

  it("waits one frame when the tab is not in the tree yet", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frame = cb;
      return 1;
    });

    scheduleRevealDockviewTabByPanelId("panel-late", document);
    const root = mountTab("panel-late", {
      bottom: 34,
      left: 120,
      right: 200,
      top: 0,
    });
    expect(root.querySelector(".dv-tabs-container")?.scrollLeft).toBe(0);

    frame?.(0);
    expect(root.querySelector(".dv-tabs-container")?.scrollLeft).toBe(88);
  });

  it("aborts an in-flight settle when the user scroll wins", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frame = cb;
      return 1;
    });

    scheduleRevealDockviewTabByPanelId("panel-late", document);
    abortScheduledDockviewTabReveal();
    const root = mountTab("panel-late", {
      bottom: 34,
      left: 120,
      right: 200,
      top: 0,
    });
    frame?.(0);
    expect(root.querySelector(".dv-tabs-container")?.scrollLeft).toBe(0);
  });

  it("retries after layout when the first measure has no width", () => {
    let notify: (() => void) | undefined;
    const observed: Element[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          notify = () => {
            callback([] as unknown as ResizeObserverEntry[], this);
          };
        }
        disconnect(): void {}
        observe(target: Element): void {
          observed.push(target);
        }
        unobserve(): void {}
      }
    );
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });

    const root = mountTab("panel-1", {
      bottom: 34,
      left: 120,
      right: 120,
      top: 0,
    });
    scheduleRevealDockviewTabByPanelId("panel-1", root);
    expect(root.querySelector(".dv-tabs-container")?.scrollLeft).toBe(0);

    const tab = root.querySelector<HTMLElement>(".dv-tab");
    expect(tab).not.toBeNull();
    if (!tab) {
      return;
    }
    expect(observed).toContain(tab);
    expect(observed).toContain(root.querySelector(".dv-tabs-container"));
    expect(observed).not.toContain(root);
    setRect(tab, { bottom: 34, left: 120, right: 200, top: 0 });
    notify?.();
    expect(root.querySelector(".dv-tabs-container")?.scrollLeft).toBe(88);
  });
});
