import {
  PANEL_SIDEBAR_COLLAPSED_EVENT,
  readPanelSidebarCollapsed,
  togglePanelSidebarCollapsed,
  usePanelSidebarCollapsed,
  writePanelSidebarCollapsed,
} from "@pier/ui/use-panel-sidebar-preference.tsx";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

const PREFIX = "pier.test.sidebar:";

describe("panel sidebar preference", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("toggles collapsed preference and emits same-window event", () => {
    const identity = "/repo";
    expect(readPanelSidebarCollapsed(PREFIX, identity)).toBe(false);

    const events: boolean[] = [];
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        collapsed: boolean;
        identity: string;
        storagePrefix: string;
      };
      if (detail.storagePrefix === PREFIX && detail.identity === identity) {
        events.push(detail.collapsed);
      }
    };
    window.addEventListener(PANEL_SIDEBAR_COLLAPSED_EVENT, onEvent);

    expect(togglePanelSidebarCollapsed(PREFIX, identity)).toBe(true);
    expect(readPanelSidebarCollapsed(PREFIX, identity)).toBe(true);
    expect(togglePanelSidebarCollapsed(PREFIX, identity)).toBe(false);
    expect(readPanelSidebarCollapsed(PREFIX, identity)).toBe(false);
    expect(events).toEqual([true, false]);

    window.removeEventListener(PANEL_SIDEBAR_COLLAPSED_EVENT, onEvent);
  });

  it("no-ops toggle when identity is missing", () => {
    expect(togglePanelSidebarCollapsed(PREFIX, null)).toBeNull();
    writePanelSidebarCollapsed(PREFIX, "/x", true);
    expect(readPanelSidebarCollapsed(PREFIX, "/x")).toBe(true);
  });

  it("hook updates on matching CustomEvent and ignores mismatches", () => {
    const identity = "/repo-a";
    const { result } = renderHook(() =>
      usePanelSidebarCollapsed(PREFIX, identity)
    );
    expect(result.current[0]).toBe(false);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(PANEL_SIDEBAR_COLLAPSED_EVENT, {
          detail: {
            collapsed: true,
            identity: "/other",
            storagePrefix: PREFIX,
          },
        })
      );
    });
    expect(result.current[0]).toBe(false);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(PANEL_SIDEBAR_COLLAPSED_EVENT, {
          detail: {
            collapsed: true,
            identity,
            storagePrefix: PREFIX,
          },
        })
      );
    });
    expect(result.current[0]).toBe(true);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(PANEL_SIDEBAR_COLLAPSED_EVENT, {
          detail: {
            collapsed: false,
            identity,
            storagePrefix: "pier.other:",
          },
        })
      );
    });
    expect(result.current[0]).toBe(true);
  });

  it("hook updates on storage events for the preference key", () => {
    const identity = "/repo-b";
    const key = `${PREFIX}${identity}`;
    const { result } = renderHook(() =>
      usePanelSidebarCollapsed(PREFIX, identity)
    );
    expect(result.current[0]).toBe(false);

    act(() => {
      localStorage.setItem(key, "true");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          newValue: "true",
          oldValue: "false",
          storageArea: localStorage,
        })
      );
    });
    expect(result.current[0]).toBe(true);
  });
});
