import { afterEach, describe, expect, it, vi } from "vitest";
import { activateTerminalPanelFromFocusRequest } from "@/lib/workspace/terminal-focus-request.ts";

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

describe("activateTerminalPanelFromFocusRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("activates only the requested terminal panel", () => {
    const terminalSetActive = vi.fn();
    const webSetActive = vi.fn();
    const api = {
      panels: [
        {
          api: { setActive: webSetActive },
          id: "web-1",
          view: { contentComponent: "web" },
        },
        {
          api: { setActive: terminalSetActive },
          id: "terminal-2",
          view: { contentComponent: "terminal" },
        },
      ],
    };

    const result = activateTerminalPanelFromFocusRequest(api, "terminal-2");

    expect(result).toEqual({ ok: true });
    expect(terminalSetActive).toHaveBeenCalledOnce();
    expect(webSetActive).not.toHaveBeenCalled();
  });

  it("ignores unknown panels and non-terminal panels", () => {
    const setActive = vi.fn();
    const api = {
      panels: [
        {
          api: { setActive },
          id: "web-1",
          view: { contentComponent: "web" },
        },
      ],
    };

    expect(activateTerminalPanelFromFocusRequest(api, "missing")).toEqual(
      expect.objectContaining({ code: "not_found", ok: false })
    );
    expect(activateTerminalPanelFromFocusRequest(api, "web-1")).toEqual(
      expect.objectContaining({ code: "kind_mismatch", ok: false })
    );
    expect(setActive).not.toHaveBeenCalled();
  });

  it("does not reveal the tab when activating from native terminal content", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    });
    const setActive = vi.fn();
    const tabsContainer = document.createElement("div");
    const tab = document.createElement("div");
    const tabContent = document.createElement("div");
    tabsContainer.className = "dv-tabs-container";
    tab.className = "dv-tab";
    tabContent.dataset.panelTabId = "terminal-1";
    tab.append(tabContent);
    tabsContainer.append(tab);
    document.body.append(tabsContainer);
    tabsContainer.scrollLeft = 0;
    setRect(tabsContainer, { bottom: 34, left: 0, right: 120, top: 0 });
    setRect(tab, { bottom: 34, left: 120, right: 200, top: 0 });

    const result = activateTerminalPanelFromFocusRequest(
      {
        panels: [
          {
            api: { setActive },
            id: "terminal-1",
            view: { contentComponent: "terminal" },
          },
        ],
      },
      "terminal-1"
    );

    expect(result).toEqual({ ok: true });
    expect(setActive).toHaveBeenCalledOnce();
    expect(tabsContainer.scrollLeft).toBe(0);
  });
});
