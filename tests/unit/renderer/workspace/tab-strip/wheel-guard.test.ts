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

function dispatchWheel(element: Element): WheelEvent {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaX: 40,
    deltaY: 0,
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

describe("tab strip wheel guard", () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.innerHTML = "";
  });

  function mountStrip(): void {
    document.body.innerHTML = STRIP_MARKUP;
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

  it("keeps dockview's own wheel listener reachable", () => {
    // preventDefault does not stop propagation: the guard must not break
    // dockview's bubble-phase scroll mapping.
    mountStrip();
    const tabs = document.querySelector(".dv-tabs-container");
    if (!tabs) {
      throw new Error("missing tabs container");
    }
    let reachedTarget = false;
    tabs.addEventListener("wheel", () => {
      reachedTarget = true;
    });
    dispatchWheel(tabs);
    expect(reachedTarget).toBe(true);
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
