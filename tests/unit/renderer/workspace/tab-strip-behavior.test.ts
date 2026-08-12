import { afterEach, describe, expect, it, vi } from "vitest";
import { attachWorkspaceTabStripBehavior } from "@/components/workspace/tab-strip-behavior.ts";
import { withSuppressedTabReveal } from "@/lib/workspace/tab-reveal-suppress.ts";

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

function mountGroupTab(panelId: string, scrollLeft: number) {
  const groupEl = document.createElement("div");
  groupEl.className = "dv-groupview";
  const tabs = document.createElement("div");
  tabs.className = "dv-tabs-container";
  Object.defineProperty(tabs, "clientWidth", {
    configurable: true,
    get: () => 120,
  });
  const tab = document.createElement("div");
  tab.className = "dv-tab";
  const content = document.createElement("div");
  content.dataset.panelTabId = panelId;
  tab.append(content);
  tabs.append(tab);
  groupEl.append(tabs);
  document.body.append(groupEl);
  tabs.scrollLeft = scrollLeft;
  setRect(tabs, { bottom: 34, left: 0, right: 120, top: 0 });
  setRect(tab, { bottom: 34, left: 120, right: 200, top: 0 });
  return { groupEl, tabs, tab, panelId };
}

type Listener = (payload: unknown) => void;

function createApiMock(group: {
  activePanel: { id: string };
  element: HTMLElement;
  id: string;
}) {
  const maximizedListeners = new Set<Listener>();
  const activeGroupListeners = new Set<Listener>();
  const layoutListeners = new Set<Listener>();

  return {
    api: {
      groups: [group],
      onDidActiveGroupChange: (listener: Listener) => {
        activeGroupListeners.add(listener);
        return {
          dispose: () => {
            activeGroupListeners.delete(listener);
          },
        };
      },
      onDidLayoutChange: (listener: Listener) => {
        layoutListeners.add(listener);
        return {
          dispose: () => {
            layoutListeners.delete(listener);
          },
        };
      },
      onDidMaximizedGroupChange: (listener: Listener) => {
        maximizedListeners.add(listener);
        return {
          dispose: () => {
            maximizedListeners.delete(listener);
          },
        };
      },
    },
    fireActiveGroup: (next: typeof group | undefined) => {
      for (const listener of activeGroupListeners) {
        listener(next);
      }
    },
    fireMaximized: (isMaximized: boolean) => {
      for (const listener of maximizedListeners) {
        listener({ group, isMaximized });
      }
    },
  };
}

describe("attachWorkspaceTabStripBehavior", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("restores tab strip scroll after exit maximize", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });

    const mounted = mountGroupTab("terminal-1", 88);
    const group = {
      activePanel: { id: "terminal-1" },
      element: mounted.groupEl,
      id: "group-1",
    };
    const { api, fireMaximized } = createApiMock(group);
    const dispose = attachWorkspaceTabStripBehavior(
      api as never,
      document.body
    );

    mounted.tabs.scrollLeft = 88;
    mounted.tabs.dispatchEvent(new Event("scroll"));

    fireMaximized(true);
    mounted.tabs.scrollLeft = 0;

    fireMaximized(false);
    frames[0]?.(0);
    frames[1]?.(0);

    expect(mounted.tabs.scrollLeft).toBe(88);
    dispose();
  });

  it("reveals the active tab when the focused group changes", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    });

    const mounted = mountGroupTab("terminal-1", 0);
    const group = {
      activePanel: { id: "terminal-1" },
      element: mounted.groupEl,
      id: "group-1",
    };
    const { api, fireActiveGroup } = createApiMock(group);
    const dispose = attachWorkspaceTabStripBehavior(
      api as never,
      document.body
    );

    fireActiveGroup(group);

    expect(mounted.tabs.scrollLeft).toBe(88);
    dispose();
  });

  it("does not reveal when tab reveal is suppressed (terminal surface focus)", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    });

    const mounted = mountGroupTab("terminal-1", 0);
    const group = {
      activePanel: { id: "terminal-1" },
      element: mounted.groupEl,
      id: "group-1",
    };
    const { api, fireActiveGroup } = createApiMock(group);
    const dispose = attachWorkspaceTabStripBehavior(
      api as never,
      document.body
    );

    withSuppressedTabReveal(() => {
      fireActiveGroup(group);
    });

    expect(mounted.tabs.scrollLeft).toBe(0);
    dispose();
  });
});
