import { afterEach, describe, expect, it, vi } from "vitest";
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";

function panel(id: string, component: string) {
  return {
    api: { setActive: vi.fn() },
    id,
    view: { contentComponent: component },
  };
}

function kindOfComponent(component: string): "terminal" | "web" {
  return component === "terminal" ? "terminal" : "web";
}

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

function mountHiddenTab(panelId: string): HTMLElement {
  const root = document.createElement("div");
  const tabsContainer = document.createElement("div");
  const tab = document.createElement("div");
  const tabContent = document.createElement("div");
  tabsContainer.className = "dv-tabs-container";
  tab.className = "dv-tab";
  tabContent.dataset.panelTabId = panelId;
  tab.append(tabContent);
  tabsContainer.append(tab);
  root.append(tabsContainer);
  document.body.append(root);
  tabsContainer.scrollLeft = 0;
  setRect(tabsContainer, { bottom: 34, left: 0, right: 120, top: 0 });
  setRect(tab, { bottom: 34, left: 120, right: 200, top: 0 });
  return root;
}

describe("activateWorkspacePanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("activates and reveals the requested panel when reveal is always", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    });
    const terminal = panel("terminal-1", "terminal");
    const root = mountHiddenTab("terminal-1");

    const result = activateWorkspacePanel(
      { panels: [terminal] },
      "terminal-1",
      {
        kindOfComponent,
        reveal: "always",
        root,
      }
    );

    expect(result).toEqual({ ok: true });
    expect(terminal.api.setActive).toHaveBeenCalledOnce();
    expect(root.querySelector(".dv-tabs-container")?.scrollLeft).toBe(88);
  });

  it("activates without revealing when reveal is never", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    });
    const terminal = panel("terminal-1", "terminal");
    const root = mountHiddenTab("terminal-1");

    const result = activateWorkspacePanel(
      { panels: [terminal] },
      "terminal-1",
      {
        kindOfComponent,
        reveal: "never",
        root,
      }
    );

    expect(result).toEqual({ ok: true });
    expect(terminal.api.setActive).toHaveBeenCalledOnce();
    expect(root.querySelector(".dv-tabs-container")?.scrollLeft).toBe(0);
  });

  it("returns not_found without activating when the panel is missing", () => {
    const terminal = panel("terminal-1", "terminal");

    const result = activateWorkspacePanel({ panels: [terminal] }, "missing", {
      kindOfComponent,
      reveal: "always",
    });

    expect(result).toEqual({
      code: "not_found",
      message: "panel not found: missing",
      ok: false,
    });
    expect(terminal.api.setActive).not.toHaveBeenCalled();
  });

  it("returns kind_mismatch without activating when the panel kind differs", () => {
    const web = panel("welcome-1", "welcome");

    const result = activateWorkspacePanel({ panels: [web] }, "welcome-1", {
      expectedKind: "terminal",
      kindOfComponent,
      reveal: "always",
    });

    expect(result).toEqual({
      code: "kind_mismatch",
      message: "panel is not terminal: welcome-1",
      ok: false,
    });
    expect(web.api.setActive).not.toHaveBeenCalled();
  });
});
