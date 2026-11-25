import { afterEach, describe, expect, it } from "vitest";
import {
  installTabStripWheelGuard,
  TAB_STRIP_WHEEL_GUARD_SELECTOR,
} from "@/lib/workspace/tab-strip-wheel-guard.ts";

const STRIP_MARKUP = `
  <div class="dv-tabs-and-actions-container">
    <div class="dv-void-container" data-testid="void"></div>
    <div class="dv-scrollable">
      <div class="dv-tabs-container">
        <div class="dv-tab"><span data-testid="tab-label">tab</span></div>
      </div>
      <div class="dv-scrollbar" data-testid="thumb"></div>
    </div>
    <div class="dv-right-actions-container">
      <button data-testid="header-action" type="button">+</button>
    </div>
  </div>
  <div class="dv-content-container">
    <div data-testid="content">content</div>
  </div>
`;

const VERTICAL_STRIP_MARKUP = `
  <div class="dv-tabs-and-actions-container">
    <div class="dv-scrollable">
      <div class="dv-tabs-container dv-tabs-container-vertical">
        <div class="dv-tab"><span data-testid="tab-label">tab</span></div>
      </div>
    </div>
  </div>
`;

interface WheelDelta {
  deltaX: number;
  deltaY: number;
}

const DEFAULT_DELTA: WheelDelta = { deltaX: 40, deltaY: 0 };

function dispatchWheel(
  element: Element,
  delta: WheelDelta = DEFAULT_DELTA
): WheelEvent {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaX: delta.deltaX,
    deltaY: delta.deltaY,
  });
  element.dispatchEvent(event);
  return event;
}

function requireElement(testId: string): Element {
  const element = document.querySelector(`[data-testid="${testId}"]`);
  if (!element) {
    throw new Error(`missing ${testId}`);
  }
  return element;
}

/**
 * jsdom has no layout, so scroll metrics are stubbed with browser-like
 * clamping: this is what makes "never past either end" observable.
 */
function stubAxisMetrics(
  element: Element,
  axis: "x" | "y",
  options: { scrollSize: number; clientSize: number; initial?: number }
): { read: () => number } {
  let offset = options.initial ?? 0;
  const max = Math.max(options.scrollSize - options.clientSize, 0);
  const sizeKey = axis === "x" ? "scrollWidth" : "scrollHeight";
  const clientKey = axis === "x" ? "clientWidth" : "clientHeight";
  const offsetKey = axis === "x" ? "scrollLeft" : "scrollTop";
  Object.defineProperty(element, sizeKey, {
    configurable: true,
    get: () => options.scrollSize,
  });
  Object.defineProperty(element, clientKey, {
    configurable: true,
    get: () => options.clientSize,
  });
  Object.defineProperty(element, offsetKey, {
    configurable: true,
    get: () => offset,
    set: (next: number) => {
      offset = Math.min(Math.max(next, 0), max);
    },
  });
  return { read: () => offset };
}

describe("tab strip wheel guard", () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.innerHTML = "";
  });

  function mountStrip(markup: string = STRIP_MARKUP): void {
    document.body.innerHTML = markup;
    dispose = installTabStripWheelGuard(document);
  }

  it("selects the whole tab bar container", () => {
    expect(TAB_STRIP_WHEEL_GUARD_SELECTOR).toBe(
      ".dv-tabs-and-actions-container"
    );
  });

  it("cancels the native default for every tab-bar region", () => {
    // Tab label, custom scrollbar lane, void filler and right actions are all
    // tab-bar chrome; any of them can start a gesture that the compositor
    // would otherwise take into the native elastic scroll chain.
    mountStrip();
    for (const testId of ["tab-label", "thumb", "void", "header-action"]) {
      expect(
        dispatchWheel(requireElement(testId)).defaultPrevented,
        testId
      ).toBe(true);
    }
  });

  it("scrolls the strip itself and stops at both ends", () => {
    mountStrip();
    const tabs = document.querySelector(".dv-tabs-container");
    if (!tabs) {
      throw new Error("missing tabs container");
    }
    const metrics = stubAxisMetrics(tabs, "x", {
      scrollSize: 600,
      clientSize: 200,
    });

    dispatchWheel(requireElement("tab-label"), { deltaX: 120, deltaY: 0 });
    expect(metrics.read()).toBe(120);

    // Past the right end: clamped to max instead of leaking to another writer.
    dispatchWheel(requireElement("tab-label"), { deltaX: 500, deltaY: 0 });
    expect(metrics.read()).toBe(400);

    // Past the left end: clamped to 0.
    dispatchWheel(requireElement("tab-label"), { deltaX: -999, deltaY: 0 });
    expect(metrics.read()).toBe(0);
  });

  it("follows the gesture's dominant axis", () => {
    mountStrip();
    const tabs = document.querySelector(".dv-tabs-container");
    if (!tabs) {
      throw new Error("missing tabs container");
    }
    const metrics = stubAxisMetrics(tabs, "x", {
      scrollSize: 600,
      clientSize: 200,
    });

    // Trackpad horizontal swipe: the residual deltaY must not drag the strip.
    dispatchWheel(requireElement("tab-label"), { deltaX: 60, deltaY: -40 });
    expect(metrics.read()).toBe(60);

    // Plain mouse wheel (deltaX === 0) still pages the strip along its axis.
    dispatchWheel(requireElement("tab-label"), { deltaX: 0, deltaY: 100 });
    expect(metrics.read()).toBe(160);
  });

  it("scrolls a vertical strip on scrollTop", () => {
    mountStrip(VERTICAL_STRIP_MARKUP);
    const tabs = document.querySelector(".dv-tabs-container");
    if (!tabs) {
      throw new Error("missing tabs container");
    }
    const metrics = stubAxisMetrics(tabs, "y", {
      scrollSize: 900,
      clientSize: 300,
    });
    dispatchWheel(requireElement("tab-label"), { deltaX: 0, deltaY: 200 });
    expect(metrics.read()).toBe(200);
    dispatchWheel(requireElement("tab-label"), { deltaX: 0, deltaY: -999 });
    expect(metrics.read()).toBe(0);
  });

  it("stops the event so dockview's own writers never run", () => {
    // dockview writes scrollLeft twice over (tabs.js, then its custom
    // Scrollbar with a deltaY-only accumulator); leaving the guard to a single
    // writer is the whole point of stopping propagation here.
    mountStrip();
    const tabs = document.querySelector(".dv-tabs-container");
    if (!tabs) {
      throw new Error("missing tabs container");
    }
    let reachedTarget = false;
    let reachedDocument = false;
    tabs.addEventListener("wheel", () => {
      reachedTarget = true;
    });
    document.addEventListener("wheel", () => {
      reachedDocument = true;
    });
    dispatchWheel(tabs);
    expect(reachedTarget).toBe(false);
    expect(reachedDocument).toBe(false);
  });

  it("cannot be bypassed by a tab-bar listener that stops propagation", () => {
    mountStrip();
    const tabs = document.querySelector(".dv-tabs-container");
    if (!tabs) {
      throw new Error("missing tabs container");
    }
    // Simulates any inner wheel listener that swallows the event before it
    // bubbles: capture phase must still cancel the native default.
    tabs.addEventListener("wheel", (event) => {
      event.stopPropagation();
    });
    expect(dispatchWheel(tabs).defaultPrevented).toBe(true);
  });

  it("leaves wheel gestures outside the tab bar alone", () => {
    mountStrip();
    expect(dispatchWheel(requireElement("content")).defaultPrevented).toBe(
      false
    );
  });

  it("removes the listener on dispose", () => {
    mountStrip();
    dispose?.();
    dispose = undefined;
    expect(dispatchWheel(requireElement("tab-label")).defaultPrevented).toBe(
      false
    );
  });
});
